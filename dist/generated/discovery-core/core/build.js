/**
 * Host-independent assembly of LiteLLM deployments and models.dev catalog into ModelSpec[].
 * This module contains no host SDK imports; protocol mapping belongs to each plugin adapter.
 */
import { mapCapabilities } from "./capabilities.js";
import { groupLiteLLMDeployments } from "./litellm.js";
import { buildVariants, releaseTimestamp, resolveReasoningState, selectModelsDevRecord, } from "./modelsdev.js";
import { resolveProtocol } from "./protocol.js";
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
    return groupLiteLLMDeployments(litellmResponse)
        .map((group) => {
        const protocol = resolveProtocol(group, options.protocolOverrides);
        const selected = selectModelsDevRecord(group, modelsDevCatalog);
        const mapped = mapCapabilities(group, selected, options.contextTierCap);
        const released = releaseTimestamp(selected);
        const sourceDate = selected?.record.release_date;
        return {
            id: group.modelName,
            name: group.modelName,
            protocol,
            capabilities: mapped.capabilities,
            variants: buildVariants(selected, protocol),
            released,
            releaseUnit: typeof sourceDate === "number" && Number.isFinite(sourceDate)
                ? "unknown"
                : typeof sourceDate === "string" && Number.isFinite(Date.parse(sourceDate)) ? "unix-ms" : "none",
            cost: mapped.cost,
            limit: mapped.limit,
            reasoningSupported: resolveReasoningState(group, selected).state,
        };
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
