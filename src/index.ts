import { Plugin } from "@opencode/plugin"
import { registerAudit } from "./host/audit-command.js"
import { registerEndpointActivation } from "./host/endpoint-command.js"
import { registerMultiEndpointAudit } from "./host/multi-audit-command.js"
import { registerIntegration, registerProvider, type ProviderSnapshot } from "./host/register.js"
import { createDiscoveryLoop, type DiscoveryDependencies, type SyncContext } from "./host/sync.js"
import {
  ACTIVATION_STORAGE_KEY,
  activeEndpointIds,
  endpointIdentity,
  parseActivation,
  type EndpointActivation,
  type EndpointIdentity,
} from "./endpoints.js"
import { parseOptions, type PluginOptions } from "./options.js"

export const PLUGIN_ID = "litellm"

type EndpointContext = Plugin.Context & SyncContext & {
  plugin?: {
    add(plugin: ReturnType<typeof Plugin.define>): Promise<void>
    remove(id: string): Promise<void>
  }
  storage?: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
  }
}

async function setupEndpoint(
  context: EndpointContext,
  endpoint: EndpointIdentity,
  options: PluginOptions,
  dependencies: DiscoveryDependencies,
  snapshots?: Map<string, ProviderSnapshot>,
  snapshotOverride?: ProviderSnapshot,
): Promise<() => Promise<void>> {
  const snapshot: ProviderSnapshot = snapshotOverride ?? { ready: false, models: [], audit: { status: "disconnected" } }
  snapshots?.set(endpoint.id, snapshot)
  const endpointOptions: PluginOptions = {
    ...options,
    endpoints: undefined,
    protocolOverrides: options.endpoints?.[endpoint.id]?.protocolOverrides ?? options.protocolOverrides,
  }
  const [integrationRegistration, providerRegistration] = await Promise.all([
    registerIntegration(context, endpoint),
    registerProvider(context, snapshot, endpoint),
  ])
  const loop = createDiscoveryLoop(context, snapshot, endpointOptions, dependencies, endpoint)
  const startup = loop.start()

  return async () => {
    await loop.dispose()
    await startup
    snapshots?.delete(endpoint.id)
    await providerRegistration.dispose()
    await integrationRegistration.dispose()
  }
}

async function readActivation(context: EndpointContext): Promise<EndpointActivation> {
  if (!context.storage) return { mode: "all" }
  try {
    const raw = await context.storage.get(ACTIVATION_STORAGE_KEY)
    return parseActivation(typeof raw === "string" ? JSON.parse(raw) : raw)
  } catch {
    return { mode: "all" }
  }
}

async function writeActivation(context: EndpointContext, value: EndpointActivation): Promise<void> {
  if (!context.storage) return
  await context.storage.set(ACTIVATION_STORAGE_KEY, JSON.stringify(value))
}

export async function setupLiteLLM(
  rawContext: Plugin.Context,
  dependencies: DiscoveryDependencies = {},
): Promise<() => Promise<void>> {
  const context = rawContext as EndpointContext
  const options = parseOptions(context.options)

  // Legacy mode keeps the old integration/credential/snapshot namespaces, while the
  // new global activation state defaults to "all" so existing users migrate with no action.
  if (options.endpoints === undefined) {
    const endpoint = endpointIdentity("default", undefined, true)
    const snapshot: ProviderSnapshot = { ready: false, models: [], audit: { status: "disconnected" } }
    let activation = await readActivation(context)
    let endpointDispose: (() => Promise<void>) | undefined

    const reconcileLegacy = async () => {
      const active = activeEndpointIds(["default"], activation).includes("default")
      if (active && !endpointDispose) {
        endpointDispose = await setupEndpoint(context, endpoint, options, dependencies, undefined, snapshot)
      } else if (!active && endpointDispose) {
        const dispose = endpointDispose
        endpointDispose = undefined
        await dispose()
        snapshot.ready = false
        snapshot.connection = undefined
        snapshot.apiBaseURL = undefined
        snapshot.models = []
        snapshot.registrationView = undefined
        snapshot.audit = { status: "disconnected" }
      }
    }

    await reconcileLegacy()
    const auditRegistration = await registerAudit(context, snapshot, {
      conversationFeedback: options.conversationFeedback,
    })
    const activationRegistration = await registerEndpointActivation(
      context,
      ["default"],
      () => activation,
      async (next) => {
        activation = next
        await writeActivation(context, next)
        await reconcileLegacy()
      },
    )

    return async () => {
      await activationRegistration.dispose()
      await auditRegistration.dispose()
      await endpointDispose?.()
    }
  }

  const endpointIds = Object.keys(options.endpoints)
  const snapshots = new Map<string, ProviderSnapshot>()
  let activation = await readActivation(context)
  const disposers = new Map<string, () => Promise<void>>()

  const activateOne = async (id: string) => {
    if (disposers.has(id)) return
    const definition = options.endpoints?.[id]
    if (!definition) return
    const endpoint = endpointIdentity(id, definition.baseUrl, false)

    if (id === "default") {
      disposers.set(id, await setupEndpoint(context, endpoint, options, dependencies, snapshots))
      return
    }

    if (!context.plugin) throw new Error("当前 OpenCode 版本不支持动态 endpoint plugin")
    await context.plugin.add(Plugin.define({
      id: endpoint.providerId,
      async setup(childContext) {
        const dispose = await setupEndpoint(childContext as EndpointContext, endpoint, options, dependencies, snapshots)
        disposers.set(id, dispose)
        return dispose
      },
    }))
  }

  const deactivateOne = async (id: string) => {
    if (!disposers.has(id)) return
    if (id === "default") {
      const dispose = disposers.get(id)
      disposers.delete(id)
      await dispose?.()
      return
    }
    disposers.delete(id)
    await context.plugin?.remove(endpointIdentity(id).providerId)
  }

  const reconcile = async () => {
    const active = new Set(activeEndpointIds(endpointIds, activation))
    for (const id of [...disposers.keys()]) if (!active.has(id)) await deactivateOne(id)
    for (const id of endpointIds) if (active.has(id)) await activateOne(id)
  }

  await reconcile()

  const auditRegistration = await registerMultiEndpointAudit(
    context,
    endpointIds,
    () => activeEndpointIds(endpointIds, activation),
    snapshots,
  )

  const activationRegistration = await registerEndpointActivation(
    context,
    endpointIds,
    () => activation,
    async (next) => {
      activation = next
      await writeActivation(context, next)
      await reconcile()
    },
  )

  return async () => {
    await activationRegistration.dispose()
    await auditRegistration.dispose()
    for (const id of [...disposers.keys()]) await deactivateOne(id)
  }
}

export default Plugin.define({
  id: PLUGIN_ID,
  setup: setupLiteLLM,
})
