/**
 * Host-independent assembly of LiteLLM deployments and models.dev catalog into ModelSpec[].
 * This module contains no host SDK imports; protocol mapping belongs to each plugin adapter.
 *
 * Single-resolver invariant (D9): every ModelSpec is projected from a
 * `ResolvedModel` via `toModelSpec()`. There is no independent parsing here.
 */
import type { ModelCapabilities, ModelCost, ModelLimits } from "./capabilities.js";
import type { CapabilityState, ModelVariant } from "./modelsdev.js";
import type { Protocol } from "./protocol.js";
import { toModelSpec } from "./resolve.js";
export interface BuildOptions {
    /** Deprecated: accepted but ignored; prices never narrow capabilities. */
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
    /**
     * Core-resolved reasoning support, independent from `variants`.
     * `supported` with empty `variants` is legal (no selectable levels).
     * Optional for wire compatibility with hand-built specs; adapters must
     * treat a missing value as unknown, never derive it from variant count.
     */
    reasoningSupported?: CapabilityState;
}
export type { CapabilityState } from "./modelsdev.js";
/**
 * Whether a neutral model has the minimum positive token limits required by
 * Pi/OpenCode to expose it as an operational conversational model.
 *
 * Core may retain zero as "unknown" for diagnostics/fingerprints, but adapters
 * must not publish zero context/output limits to their hosts.
 */
export declare function hasOperationalLimits(spec: Pick<ModelSpec, "limit">): boolean;
/** Shared existing critical-content checks for publication caches and snapshots. */
export declare function hasValidCriticalConfiguration(value: unknown): value is ModelSpec;
export declare function buildModelSpecs(litellmResponse: unknown, modelsDevCatalog: unknown, options: BuildOptions): ModelSpec[];
export declare function modelFingerprint(models: readonly ModelSpec[]): string;
/** Cache integrity for model identity, protocol and capabilities, excluding display metadata. */
export declare function criticalModelFingerprint(models: readonly ModelSpec[]): string;
export { toModelSpec };
