/**
 * Host-independent models.dev record selection and reasoning variant extraction.
 */
import { type DeploymentGroup } from "./litellm.js";
import type { Protocol } from "./protocol.js";
export interface ModelsDevRecord extends Record<string, unknown> {
    id?: unknown;
    name?: unknown;
    aliases?: unknown;
    reasoning?: unknown;
    release_date?: unknown;
    modalities?: unknown;
    limit?: unknown;
    cost?: unknown;
    tool_call?: unknown;
    reasoning_options?: unknown;
}
export type ModelsDevMatchKind = "exact" | "canonical" | "alias";
export interface SelectedModelRecord {
    providerID: string;
    modelID: string;
    record: ModelsDevRecord;
    matchedCandidate?: string;
    matchKind?: ModelsDevMatchKind;
}
export interface ModelVariant {
    id: string;
    settings: Record<string, unknown>;
}
export type ReasoningSupportSource = "litellm" | "models.dev" | "derived" | "default";
export interface ReasoningSupportResolution {
    readonly supported: boolean;
    readonly source: ReasoningSupportSource;
    readonly conflict: boolean;
}
interface FamilyProviders {
    primary: string;
    alternatives: string[];
}
/**
 * Conservative canonicalization for identity matching only. It deliberately does
 * not strip semantic suffixes such as "-free", dates, sizes, or provider tiers.
 */
export declare function canonicalModelID(value: string): string;
export declare function candidateModelIDs(group: DeploymentGroup): string[];
export declare function familyProviders(group: DeploymentGroup): FamilyProviders | undefined;
export declare function selectModelsDevRecord(group: DeploymentGroup, catalog: unknown): SelectedModelRecord | undefined;
export declare function resolveReasoningSupport(group: DeploymentGroup, selected: SelectedModelRecord | undefined): ReasoningSupportResolution;
export declare function buildVariants(selected: SelectedModelRecord | undefined, protocol: Protocol): ModelVariant[];
export declare function releaseTimestamp(selected: SelectedModelRecord | undefined): number;
export {};
