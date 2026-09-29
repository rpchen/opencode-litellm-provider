import { buildModelSpecs as discoverModelSpecs, hasOperationalLimits as coreHasOperationalLimits, modelFingerprint as discoveryFingerprint, } from "../generated/discovery-core/index.js";
import { PROTOCOL_PACKAGES } from "./protocol.js";
export function toOpenCodeModelSpec(spec) {
    const { id, name, protocol, ...metadata } = spec;
    return { id, name, protocol, package: PROTOCOL_PACKAGES[protocol], ...metadata };
}
export const hasOperationalLimits = coreHasOperationalLimits;
export function buildModelSpecs(litellmResponse, modelsDevCatalog, options) {
    return discoverModelSpecs(litellmResponse, modelsDevCatalog, options)
        .filter(hasOperationalLimits)
        .map(toOpenCodeModelSpec);
}
// Keep the host-facing signature, including package-sensitive fingerprints, unchanged.
export function modelFingerprint(models) {
    return discoveryFingerprint(models);
}
