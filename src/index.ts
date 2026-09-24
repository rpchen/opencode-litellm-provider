import { Plugin } from "@opencode/plugin"
import { registerIntegration, registerProvider, type ProviderSnapshot } from "./host/register.js"
import {
  createDiscoveryLoop,
  type DiscoveryDependencies,
  type SyncContext,
} from "./host/sync.js"
import { parseOptions } from "./options.js"

export const PLUGIN_ID = "litellm"

export async function setupLiteLLM(
  context: Plugin.Context,
  dependencies: DiscoveryDependencies = {},
): Promise<() => Promise<void>> {
  const options = parseOptions(context.options)
  const snapshot: ProviderSnapshot = { ready: false, models: [] }
  const [integrationRegistration, providerRegistration] = await Promise.all([
    registerIntegration(context),
    registerProvider(context, snapshot),
  ])
  const loop = createDiscoveryLoop(context as unknown as SyncContext, snapshot, options, dependencies)
  const startup = loop.start()

  return async () => {
    await loop.dispose()
    await startup
    await providerRegistration.dispose()
    await integrationRegistration.dispose()
  }
}

export default Plugin.define({
  id: PLUGIN_ID,
  setup: setupLiteLLM,
})
