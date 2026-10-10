/**
 * Host-independent capability, limit, modality, and price mapping.
 *
 * D9: this module no longer resolves independently. `mapCapabilities()` is
 * a legacy projection kept for direct callers and tests; the publication
 * path (`buildModelSpecs`, assessments, diagnostics, LKG) derives every
 * value from the single resolver (`resolveModel()` → `toModelSpec()`).
 *
 * Legacy projection rules (aligned with D6–D8):
 * - No `litellm_params` key narrows anything (D7a proven set is empty).
 *   Only `model_info` descriptive declarations fill gaps.
 * - `max_input_tokens` is input capacity and NEVER becomes `limit.context`.
 * - Operator-declared pricing reads `litellm_params` price keys before
 *   `model_info` keys, highest across deployments (D8).
 * - Unproven provider records never supply facts here either: callers pass
 *   only proven serving records or `undefined`.
 */
import { type DeploymentGroup } from "./litellm.js";
import { type SelectedModelRecord } from "./modelsdev.js";
export interface ModelCapabilities {
    tools: boolean;
    input: string[];
    output: string[];
}
export interface ModelLimits {
    context: number;
    input: number;
    output: number;
}
export interface ModelCost {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
}
export interface CapabilityResult {
    capabilities: ModelCapabilities;
    limit: ModelLimits;
    cost: ModelCost;
}
export declare function mapCapabilities(group: DeploymentGroup, selected: SelectedModelRecord | undefined, contextTierCap: boolean): CapabilityResult;
