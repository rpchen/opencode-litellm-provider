import { Plugin } from "@opencode/plugin"
import { registerAudit } from "./host/audit-command.js"
import { registerEndpointActivation } from "./host/endpoint-command.js"
import { registerMultiEndpointAudit } from "./host/multi-audit-command.js"
import { registerIntegration, registerIntegrations, registerProvider, type ProviderSnapshot } from "./host/register.js"
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
  registerEndpointIntegration = true,
): Promise<() => Promise<void>> {
  const snapshot: ProviderSnapshot = snapshotOverride ?? { ready: false, models: [], audit: { status: "disconnected" } }
  snapshots?.set(endpoint.id, snapshot)
  const endpointOptions: PluginOptions = {
    ...options,
    endpoints: undefined,
    protocolOverrides: options.endpoints?.[endpoint.id]?.protocolOverrides ?? options.protocolOverrides,
  }
  const integrationRegistration = registerEndpointIntegration
    ? await registerIntegration(context, endpoint)
    : undefined
  const providerRegistration = await registerProvider(context, snapshot, endpoint)
  const loop = createDiscoveryLoop(context, snapshot, endpointOptions, dependencies, endpoint)
  const startup = loop.start()

  return async () => {
    await loop.dispose()
    await startup
    snapshots?.delete(endpoint.id)
    await providerRegistration.dispose()
    await integrationRegistration?.dispose()
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
  const identities = new Map(endpointIds.map((id) => {
    const definition = options.endpoints?.[id]
    return [id, endpointIdentity(id, definition?.baseUrl, false)] as const
  }))
  const snapshots = new Map<string, ProviderSnapshot>()
  let activation = await readActivation(context)
  const disposers = new Map<string, () => Promise<void>>()
  // OpenCode V2 does not support runtime child-plugin mutation. Keep every
  // configured integration registered in this plugin instance so /connect can
  // manage an independent credential for each endpoint, while activation only
  // starts/stops provider discovery and publication.
  const integrationRegistration = await registerIntegrations(context, [...identities.values()])

  const activateOne = async (id: string) => {
    if (disposers.has(id)) return
    const endpoint = identities.get(id)
    if (!endpoint) return
    disposers.set(id, await setupEndpoint(
      context,
      endpoint,
      options,
      dependencies,
      snapshots,
      undefined,
      false,
    ))
  }

  const deactivateOne = async (id: string) => {
    const dispose = disposers.get(id)
    if (!dispose) return
    disposers.delete(id)
    await dispose()
  }

  const reconcile = async () => {
    const active = new Set(activeEndpointIds(endpointIds, activation))
    for (const id of [...disposers.keys()]) if (!active.has(id)) await deactivateOne(id)
    for (const id of endpointIds) if (active.has(id)) await activateOne(id)
  }

  try {
    await reconcile()
  } catch (error) {
    for (const id of [...disposers.keys()]) await deactivateOne(id)
    await integrationRegistration.dispose()
    throw error
  }

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
    await integrationRegistration.dispose()
  }
}

export default Plugin.define({
  id: PLUGIN_ID,
  setup: setupLiteLLM,
})
