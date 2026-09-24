import type { Protocol } from "../options.js";
import { type DeploymentGroup } from "./litellm.js";
export interface ModelsDevRecord extends Record<string, unknown> {
    id?: unknown;
    name?: unknown;
    release_date?: unknown;
    modalities?: unknown;
    limit?: unknown;
    cost?: unknown;
    tool_call?: unknown;
    reasoning_options?: unknown;
}
export interface SelectedModelRecord {
    providerID: string;
    modelID: string;
    record: ModelsDevRecord;
}
export interface ModelVariant {
    id: string;
    settings: Record<string, unknown>;
}
interface FamilyProviders {
    primary: string;
    alternatives: string[];
}
export declare function candidateModelIDs(group: DeploymentGroup): string[];
export declare function familyProviders(group: DeploymentGroup): FamilyProviders | undefined;
export declare function selectModelsDevRecord(group: DeploymentGroup, catalog: unknown): SelectedModelRecord | undefined;
export declare function buildVariants(selected: SelectedModelRecord | undefined, protocol: Protocol): ModelVariant[];
export declare function releaseTimestamp(selected: SelectedModelRecord | undefined): number;
export {};
