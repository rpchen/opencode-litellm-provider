/** Public compatibility mapping delegates to the same model resolver. */
import { isRecord, optionalNumber } from "./litellm.js";
import { resolveSelectedModel } from "./resolve.js";
/** Optional reference prices never affect configuration validity. */
export function normalizeModelCost(value) {
    const cost = isRecord(value) ? value : {};
    const price = (key) => { const value = optionalNumber(cost[key]); return value !== undefined && value >= 0 ? value : 0; };
    return { input: price("input"), output: price("output"), cacheRead: price("cacheRead"), cacheWrite: price("cacheWrite") };
}
export function mapCapabilities(group, selected, contextTierCap) {
    const { capabilities, limit, cost } = resolveSelectedModel(group, selected).spec;
    return { capabilities, limit, cost };
}
