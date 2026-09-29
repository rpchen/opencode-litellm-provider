import { buildModelSpecs as discoverModelSpecs, hasOperationalLimits, modelFingerprint as discoveryFingerprint, } from "../generated/discovery-core/index.js";
import { PROTOCOL_PACKAGES } from "./protocol.js";
export function toOpenCodeModelSpec(spec) {
    const { id, name, protocol, ...metadata } = spec;
    return { id, name, protocol, package: PROTOCOL_PACKAGES[protocol], ...metadata };
}
export function filterOperationalModelSpecs(models) {
    return models.filter(hasOperationalLimits);
}
export function toOperationalOpenCodeModelSpecs(specs) {
    return filterOperationalModelSpecs(specs).map(toOpenCodeModelSpec);
}
export function buildModelSpecs(litellmResponse, modelsDevCatalog, options) {
    return toOperationalOpenCodeModelSpecs(discoverModelSpecs(litellmResponse, modelsDevCatalog, options));
}
// Keep the host-facing signature, including package-sensitive fingerprints, unchanged.
export function modelFingerprint(models) {
    return discoveryFingerprint(models);
}
