import { hasOperationalLimits as coreHasOperationalLimits, type BuildOptions, type BuildPublicationOptions, type ModelSpec as DiscoveryModelSpec, type PublishableEntry, type PublicationResult } from "../generated/discovery-core/index.js";
export type { BuildOptions } from "../generated/discovery-core/index.js";
/** OpenCode-only SDK package; all model semantics remain Core-owned. */
export interface ModelSpec extends DiscoveryModelSpec {
    package: string;
}
export declare function toOpenCodeModelSpec(spec: DiscoveryModelSpec): ModelSpec;
/** Map Core's configured partition without re-deriving capabilities. */
export declare function toOpenCodeModelSpecWithPublication(entry: PublishableEntry): ModelSpec;
export declare const hasOperationalLimits: typeof coreHasOperationalLimits;
export declare function buildModelSpecs(litellmResponse: unknown, modelsDevCatalog: unknown, options: BuildOptions): ModelSpec[];
export interface PublicationModels {
    readonly models: ModelSpec[];
    readonly result: PublicationResult;
}
/**
 * Partition discovery through the Core publication policy and map only
 * publishable entries (configured and configured-lkg) to host shapes, keeping the operational-limits guard as
 * defense in depth. Blocked models never reach the returned list.
 */
export declare function buildPublicationModels(litellmResponse: unknown, modelsDevCatalog: unknown, options: BuildOptions, publication?: BuildPublicationOptions): PublicationModels;
export declare function modelFingerprint(models: readonly ModelSpec[]): string;
