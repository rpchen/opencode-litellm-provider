/**
 * Host-independent assembly of LiteLLM deployments and models.dev catalog into ModelSpec[].
 * This module contains no host SDK imports; protocol mapping belongs to each plugin adapter.
 */
import { type ModelCapabilities, type ModelCost, type ModelLimits } from "./capabilities.js";
import { type ModelVariant } from "./modelsdev.js";
import { type Protocol } from "./protocol.js";
export interface BuildOptions {
    contextTierCap: boolean;
    protocolOverrides: Readonly<Record<string, Protocol>>;
}
export interface ModelSpec {
    id: string;
    name: string;
    protocol: Protocol;
    capabilities: ModelCapabilities;
    variants: ModelVariant[];
    released: number;
    releaseUnit?: "unix-ms" | "unknown" | "none";
    cost: ModelCost;
    limit: ModelLimits;
}
/**
 * Whether a neutral model has the minimum positive token limits required by
 * Pi/OpenCode to expose it as an operational conversational model.
 *
 * Core may retain zero as "unknown" for diagnostics/fingerprints, but adapters
 * must not publish zero context/output limits to their hosts.
 */
export declare function hasOperationalLimits(spec: Pick<ModelSpec, "limit">): boolean;
export declare function buildModelSpecs(litellmResponse: unknown, modelsDevCatalog: unknown, options: BuildOptions): ModelSpec[];
export declare function modelFingerprint(models: readonly ModelSpec[]): string;
