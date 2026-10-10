import { groupLiteLLMDeployments } from "./litellm.js";
import { resolveProtocol } from "./protocol.js";
import { resolveModel, toModelSpec } from "./resolve.js";
/**
 * Whether a neutral model has the minimum positive token limits required by
 * Pi/OpenCode to expose it as an operational conversational model.
 *
 * Core may retain zero as "unknown" for diagnostics/fingerprints, but adapters
 * must not publish zero context/output limits to their hosts.
 */
export function hasOperationalLimits(spec) {
    return spec.limit.context > 0 && spec.limit.output > 0;
}
export function buildModelSpecs(litellmResponse, modelsDevCatalog, options) {
    void resolveProtocol;
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
export { toModelSpec };
