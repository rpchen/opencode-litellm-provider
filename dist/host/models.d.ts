import { hasOperationalLimits as coreHasOperationalLimits, type BuildOptions, type BuildPublicationOptions, type ModelSpec as DiscoveryModelSpec, type PublishableEntry, type PublicationResult } from "../generated/discovery-core/index.js";
export type { BuildOptions } from "../generated/discovery-core/index.js";
/** OpenCode-only metadata. The shared ModelSpec deliberately has no SDK package. */
export interface ModelSpec extends DiscoveryModelSpec {
    package: string;
}
export declare function toOpenCodeModelSpec(spec: DiscoveryModelSpec): ModelSpec;
/**
 * Map one Core publication entry to its host shape.
 *
 * Conservative tool mapping: `unknown` tool support (possible only on
 * user-accepted degraded entries) registers as disabled, while
 * diagnostics still reports the Core `unknown` verdict.
 */
export declare function toOpenCodeModelSpecWithPublication(entry: PublishableEntry): ModelSpec;
export declare const hasOperationalLimits: typeof coreHasOperationalLimits;
export declare function buildModelSpecs(litellmResponse: unknown, modelsDevCatalog: unknown, options: BuildOptions): ModelSpec[];
export interface PublicationModels {
    readonly models: ModelSpec[];
    readonly result: PublicationResult;
}
/**
 * Partition discovery through the Core publication policy and map only
 * publishable entries (configured, configured-lkg, user-accepted
 * degraded) to host shapes, keeping the operational-limits guard as
 * defense in depth. Blocked models never reach the returned list.
 */
export declare function buildPublicationModels(litellmResponse: unknown, modelsDevCatalog: unknown, options: BuildOptions, publication?: BuildPublicationOptions): PublicationModels;
export declare function modelFingerprint(models: readonly ModelSpec[]): string;
