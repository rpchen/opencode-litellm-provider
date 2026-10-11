import { buildModelSpecs as discoverModelSpecs, buildPublicationResult, hasOperationalLimits as coreHasOperationalLimits, modelFingerprint as discoveryFingerprint, } from "../generated/discovery-core/index.js";
import { PROTOCOL_PACKAGES } from "./protocol.js";
export function toOpenCodeModelSpec(spec) {
    return { ...spec, package: PROTOCOL_PACKAGES[spec.protocol] };
}
/** Map Core's configured partition without re-deriving capabilities. */
export function toOpenCodeModelSpecWithPublication(entry) {
    return toOpenCodeModelSpec(entry.spec);
}
export const hasOperationalLimits = coreHasOperationalLimits;
export function buildModelSpecs(litellmResponse, modelsDevCatalog, options) {
    return discoverModelSpecs(litellmResponse, modelsDevCatalog, options)
        .filter(hasOperationalLimits)
        .map(toOpenCodeModelSpec);
}
/**
 * Partition discovery through the Core publication policy and map only
 * publishable entries (configured and configured-lkg) to host shapes, keeping the operational-limits guard as
 * defense in depth. Blocked models never reach the returned list.
 */
export function buildPublicationModels(litellmResponse, modelsDevCatalog, options, publication = {}) {
    const result = buildPublicationResult(litellmResponse, modelsDevCatalog, options, publication);
    const models = result.publishable
        .map(toOpenCodeModelSpecWithPublication)
        .filter(hasOperationalLimits);
    return { models, result };
}
// Keep the host-facing signature, including package-sensitive fingerprints, unchanged.
export function modelFingerprint(models) {
    return discoveryFingerprint(models);
}
