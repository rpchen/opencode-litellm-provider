import { buildModelSpecs as discoverModelSpecs, buildPublicationResult, hasOperationalLimits as coreHasOperationalLimits, hostToolsFlag, modelFingerprint as discoveryFingerprint, } from "../generated/discovery-core/index.js";
import { PROTOCOL_PACKAGES } from "./protocol.js";
export function toOpenCodeModelSpec(spec) {
    const { id, name, protocol, ...metadata } = spec;
    return { id, name, protocol, package: PROTOCOL_PACKAGES[protocol], ...metadata };
}
/**
 * Map one Core publication entry to its host shape.
 *
 * Conservative tool mapping: `unknown` tool support (possible only on
 * user-accepted degraded entries) registers as disabled, while
 * diagnostics still reports the Core `unknown` verdict.
 */
export function toOpenCodeModelSpecWithPublication(entry) {
    const mapped = toOpenCodeModelSpec(entry.spec);
    const tools = hostToolsFlag(entry.assessment, entry.spec.capabilities.tools);
    if (tools === mapped.capabilities.tools)
        return mapped;
    return { ...mapped, capabilities: { ...mapped.capabilities, tools } };
}
export const hasOperationalLimits = coreHasOperationalLimits;
export function buildModelSpecs(litellmResponse, modelsDevCatalog, options) {
    return discoverModelSpecs(litellmResponse, modelsDevCatalog, options)
        .filter(hasOperationalLimits)
        .map(toOpenCodeModelSpec);
}
/**
 * Partition discovery through the Core publication policy and map only
 * publishable entries (configured, configured-lkg, user-accepted
 * degraded) to host shapes, keeping the operational-limits guard as
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
