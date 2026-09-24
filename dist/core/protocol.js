import { optionalString, stripRoutePrefix, } from "./litellm.js";
export const PROTOCOL_PACKAGES = {
    chat: "@opencode/ai/providers/openai-compatible",
    responses: "@opencode/ai/providers/openai-compatible-responses",
    messages: "@opencode/ai/providers/anthropic-compatible",
};
function isClaudeName(value) {
    const model = optionalString(value);
    return model !== undefined && stripRoutePrefix(model).toLowerCase().startsWith("claude-");
}
function isAnthropic(deployment) {
    const upstream = optionalString(deployment.modelInfo.litellm_provider)?.toLowerCase();
    const custom = optionalString(deployment.litellmParams.custom_llm_provider)?.toLowerCase();
    const routedModel = optionalString(deployment.litellmParams.model);
    return (upstream === "anthropic" ||
        custom === "anthropic" ||
        routedModel?.toLowerCase().startsWith("anthropic/") === true ||
        isClaudeName(deployment.modelInfo.base_model) ||
        isClaudeName(routedModel) ||
        isClaudeName(deployment.modelName));
}
function normalizeEndpoint(value) {
    return value.toLowerCase().replace(/^\//, "").replace(/^v1\//, "");
}
export function deploymentProtocol(deployment) {
    if (isAnthropic(deployment))
        return "messages";
    const endpoints = deployment.modelInfo.supported_endpoints;
    if (Array.isArray(endpoints)) {
        const normalized = new Set(endpoints
            .filter((endpoint) => typeof endpoint === "string")
            .map(normalizeEndpoint));
        if (normalized.has("responses"))
            return "responses";
        if (normalized.has("chat/completions"))
            return "chat";
    }
    return optionalString(deployment.modelInfo.mode)?.toLowerCase() === "responses"
        ? "responses"
        : "chat";
}
export function resolveProtocol(group, overrides = {}) {
    const override = overrides[group.modelName];
    if (override)
        return override;
    const protocols = new Set(group.deployments.map(deploymentProtocol));
    return protocols.size === 1 ? (protocols.values().next().value ?? "chat") : "chat";
}
