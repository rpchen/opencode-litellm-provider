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
export declare function buildModelSpecs(litellmResponse: unknown, modelsDevCatalog: unknown, options: BuildOptions): ModelSpec[];
export declare function modelFingerprint(models: readonly ModelSpec[]): string;
