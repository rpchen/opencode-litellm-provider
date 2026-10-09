/**
 * Catalog input contract (D2).
 *
 * Core consumes the models.dev catalog as one snapshot containing both the
 * provider-agnostic canonical registry (`models`) and the provider-specific
 * serving records (`providers`). Classification is exhaustive over every
 * possible input:
 * - `complete`: top-level `providers` + `models` both valid objects, `models`
 *   keys are `<lab>/<model>` identities. Unknown extra top-level keys are
 *   ignored.
 * - `providers-only`: legacy provider map shape (multiple provider values
 *   containing a `models` object). Cannot prove canonical identity; treated
 *   like unavailable (no canonical resolution, no provider record use).
 * - `unavailable`: everything else (empty, non-object, models-only, either
 *   side non-object).
 */
import { isRecord } from "./litellm.js";
function isModelsRegistry(value) {
    if (!isRecord(value))
        return false;
    const keys = Object.keys(value);
    if (keys.length === 0)
        return true;
    // Registry keys are `<lab>/<model>` identities. An empty registry is still
    // a valid (degenerate) registry; a non-empty object whose keys lack `/` is
    // not a registry.
    return keys.every((key) => key.includes("/"));
}
function isProvidersObject(value) {
    if (!isRecord(value))
        return false;
    const keys = Object.keys(value);
    if (keys.length === 0)
        return true;
    return keys.every((key) => typeof key === "string" && key.length > 0);
}
function looksLikeLegacyProviderMap(value) {
    // Legacy `api.json` shape: top-level provider map where provider values
    // contain a `models` object. Must not be confused with a catalog that has
    // exactly `providers`/`models` keys (handled before this check).
    let providerLike = 0;
    for (const item of Object.values(value)) {
        if (isRecord(item) && isRecord(item.models))
            providerLike += 1;
    }
    return providerLike > 0;
}
/**
 * Normalize any supplied catalog value into an exhaustive tri-state.
 * Never throws; unknown shapes are `unavailable`.
 */
export function normalizeModelsDevCatalog(input) {
    if (!isRecord(input))
        return { kind: "unavailable", models: {}, providers: {} };
    const providers = input.providers;
    const models = input.models;
    if (isRecord(providers) && isRecord(models)) {
        if (!isModelsRegistry(models) || !isProvidersObject(providers)) {
            return { kind: "unavailable", models: {}, providers: {} };
        }
        return {
            kind: "complete",
            models: models,
            providers: providers,
        };
    }
    // `providers`+`models` not both valid objects: legacy provider map?
    // Exclude values that have a `models` key at all (models-only or malformed
    // catalog) — those are `unavailable`, never `providers-only`.
    if (!isRecord(models) && looksLikeLegacyProviderMap(input)) {
        return { kind: "providers-only", models: {}, providers: {} };
    }
    return { kind: "unavailable", models: {}, providers: {} };
}
/** True when canonical resolution and serving selection may run. */
export function isCompleteCatalog(catalog) {
    return catalog.kind === "complete";
}
