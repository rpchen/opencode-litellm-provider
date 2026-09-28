/**
 * Host-independent protocol resolution. Host SDK package mapping belongs to plugin adapters.
 */
import { optionalString, stripRoutePrefix, } from "./litellm.js";
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
export function deploymentProtocolResolution(deployment) {
    if (isAnthropic(deployment))
        return { protocol: "messages", reason: "anthropic" };
    const endpoints = deployment.modelInfo.supported_endpoints;
    if (Array.isArray(endpoints)) {
        const normalized = new Set(endpoints
            .filter((endpoint) => typeof endpoint === "string")
            .map(normalizeEndpoint));
        if (normalized.has("responses"))
            return { protocol: "responses", reason: "supported-endpoints" };
        if (normalized.has("chat/completions"))
            return { protocol: "chat", reason: "supported-endpoints" };
    }
    if (optionalString(deployment.modelInfo.mode)?.toLowerCase() === "responses") {
        return { protocol: "responses", reason: "mode" };
    }
    return { protocol: "chat", reason: "fallback" };
}
export function deploymentProtocol(deployment) {
    return deploymentProtocolResolution(deployment).protocol;
}
export function resolveProtocolResolution(group, overrides = {}) {
    const deployments = group.deployments.map(deploymentProtocolResolution);
    const override = overrides[group.modelName];
    if (override)
        return { protocol: override, reason: "override", deployments };
    const protocols = new Set(deployments.map((item) => item.protocol));
    if (protocols.size !== 1)
        return { protocol: "chat", reason: "mixed-fallback", deployments };
    const protocol = deployments[0]?.protocol ?? "chat";
    const reasons = new Set(deployments.map((item) => item.reason));
    const reason = reasons.size === 1
        ? (deployments[0]?.reason ?? "fallback")
        : deployments.some((item) => item.reason === "fallback")
            ? "fallback"
            : "supported-endpoints";
    return { protocol, reason, deployments };
}
export function resolveProtocol(group, overrides = {}) {
    return resolveProtocolResolution(group, overrides).protocol;
}
