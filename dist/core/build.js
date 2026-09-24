import { mapCapabilities } from "./capabilities.js";
import { groupLiteLLMDeployments } from "./litellm.js";
import { buildVariants, releaseTimestamp, selectModelsDevRecord, } from "./modelsdev.js";
import { PROTOCOL_PACKAGES, resolveProtocol } from "./protocol.js";
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
            package: PROTOCOL_PACKAGES[protocol],
            capabilities: mapped.capabilities,
            variants: buildVariants(selected, protocol),
            released,
            releaseUnit: typeof sourceDate === "number" && Number.isFinite(sourceDate)
                ? "unknown"
                : typeof sourceDate === "string" && Number.isFinite(Date.parse(sourceDate)) ? "unix-ms" : "none",
            cost: mapped.cost,
            limit: mapped.limit,
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
