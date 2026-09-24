import { Plugin } from "@opencode/plugin";
import { registerIntegration, registerProvider } from "./host/register.js";
import { createDiscoveryLoop, } from "./host/sync.js";
import { parseOptions } from "./options.js";
export const PLUGIN_ID = "litellm";
export async function setupLiteLLM(context, dependencies = {}) {
    const options = parseOptions(context.options);
    const snapshot = { ready: false, models: [] };
    const [integrationRegistration, providerRegistration] = await Promise.all([
        registerIntegration(context),
        registerProvider(context, snapshot),
    ]);
    const loop = createDiscoveryLoop(context, snapshot, options, dependencies);
    const startup = loop.start();
    return async () => {
        await loop.dispose();
        await startup;
        await providerRegistration.dispose();
        await integrationRegistration.dispose();
    };
}
export default Plugin.define({
    id: PLUGIN_ID,
    setup: setupLiteLLM,
});
