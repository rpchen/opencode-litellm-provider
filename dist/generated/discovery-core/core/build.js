import { groupLiteLLMDeployments, isRecord } from "./litellm.js";
import { resolveModel, toModelSpec } from "./resolve.js";
/**
 * Whether a neutral model has the minimum positive token limits required by
 * Pi/OpenCode to expose it as an operational conversational model.
 *
 * Core may retain zero as "unknown" for diagnostics/fingerprints, but adapters
 * must not publish zero context/output limits to their hosts.
 */
export function hasOperationalLimits(spec) {
    return Number.isFinite(spec.limit.context) && spec.limit.context > 0 && Number.isFinite(spec.limit.output) && spec.limit.output > 0;
}
/** Shared existing critical-content checks for publication caches and snapshots. */
export function hasValidCriticalConfiguration(value) {
    if (!isRecord(value) || typeof value.id !== "string" || !value.id || value.name !== value.id)
        return false;
    if (value.protocol !== "chat" && value.protocol !== "responses" && value.protocol !== "messages")
        return false;
    if (!isRecord(value.limit) || !hasOperationalLimits(value) ||
        typeof value.limit.input !== "number" || !Number.isFinite(value.limit.input) || value.limit.input < 0)
        return false;
    if (!isRecord(value.capabilities) || typeof value.capabilities.tools !== "boolean")
        return false;
    const modalities = (list) => Array.isArray(list) && list.length > 0 && list.every((item) => typeof item === "string");
    if (!modalities(value.capabilities.input) || !modalities(value.capabilities.output))
        return false;
    if (value.reasoningSupported !== "supported" && value.reasoningSupported !== "unsupported")
        return false;
    return Array.isArray(value.variants) && value.variants.every((variant) => isRecord(variant) &&
        typeof variant.id === "string" && variant.id.length > 0 && isRecord(variant.settings));
}
export function buildModelSpecs(litellmResponse, modelsDevCatalog, options) {
    return groupLiteLLMDeployments(litellmResponse)
        .map((group) => {
        const resolved = resolveModel(group, modelsDevCatalog, {
            protocolOverrides: options.protocolOverrides,
            contextTierCap: options.contextTierCap,
        });
        return resolved.spec;
    })
        .sort((left, right) => left.id.localeCompare(right.id, "en"));
}
function stableValue(value) {
    if (Array.isArray(value))
        return value.map(stableValue);
    if (typeof value !== "object" || value === null)
        return value;
    return Object.fromEntries(Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, item]) => [key, stableValue(item)]));
}
export function modelFingerprint(models) {
    return JSON.stringify(stableValue(models));
}
/** Cache integrity for model identity, protocol and capabilities, excluding display metadata. */
export function criticalModelFingerprint(models) {
    return JSON.stringify(stableValue(models.map(({ cost, released, releaseUnit, ...critical }) => critical)));
}
export { toModelSpec };
