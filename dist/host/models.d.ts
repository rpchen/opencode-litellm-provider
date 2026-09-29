import { type BuildOptions, type ModelSpec as DiscoveryModelSpec } from "../generated/discovery-core/index.js";
export type { BuildOptions } from "../generated/discovery-core/index.js";
/** OpenCode-only metadata. The shared ModelSpec deliberately has no SDK package. */
export interface ModelSpec extends DiscoveryModelSpec {
    package: string;
}
export declare function toOpenCodeModelSpec(spec: DiscoveryModelSpec): ModelSpec;
export declare function filterOperationalModelSpecs<T extends Pick<DiscoveryModelSpec, "limit">>(models: readonly T[]): T[];
export declare function toOperationalOpenCodeModelSpecs(specs: readonly DiscoveryModelSpec[]): ModelSpec[];
export declare function buildModelSpecs(litellmResponse: unknown, modelsDevCatalog: unknown, options: BuildOptions): ModelSpec[];
export declare function modelFingerprint(models: readonly ModelSpec[]): string;
