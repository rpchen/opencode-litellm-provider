import { Plugin } from "@opencode/plugin";
import { registerAudit } from "./host/audit-command.js";
import { registerIntegration, registerProvider } from "./host/register.js";
import { createDiscoveryLoop, } from "./host/sync.js";
import { parseOptions } from "./options.js";
export const PLUGIN_ID = "litellm";
export async function setupLiteLLM(context, dependencies = {}) {
    const options = parseOptions(context.options);
    const snapshot = { ready: false, models: [], audit: { status: "disconnected" } };
    const [integrationRegistration, providerRegistration] = await Promise.all([
        registerIntegration(context),
        registerProvider(context, snapshot),
    ]);
    const auditRegistration = await registerAudit(context, snapshot, {
        conversationFeedback: options.conversationFeedback,
    });
    const loop = createDiscoveryLoop(context, snapshot, options, dependencies);
    const startup = loop.start();
    return async () => {
        await loop.dispose();
        await startup;
        await auditRegistration.dispose();
        await providerRegistration.dispose();
        await integrationRegistration.dispose();
    };
}
export default Plugin.define({
    id: PLUGIN_ID,
    setup: setupLiteLLM,
});
