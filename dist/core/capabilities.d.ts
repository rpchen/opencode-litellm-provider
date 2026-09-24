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
