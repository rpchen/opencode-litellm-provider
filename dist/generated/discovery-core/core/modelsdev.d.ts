/** Compatibility projection of the selected model metadata. */
import { type DeploymentGroup } from "./litellm.js";
import type { Protocol } from "./protocol.js";
export interface ModelsDevRecord extends Record<string, unknown> {
    id?: unknown;
    name?: unknown;
    aliases?: unknown;
    canonical_model_id?: unknown;
    reasoning?: unknown;
    release_date?: unknown;
    modalities?: unknown;
    limit?: unknown;
    cost?: unknown;
    tool_call?: unknown;
    reasoning_options?: unknown;
}
export type ModelsDevMatchKind = "exact" | "canonical" | "alias"
/** Matched through a deterministic metadata relation (canonical_model_id / base_model). */
 | "relation";
export type ModelsDevSelectionSource = "explicit-provider" | "canonical-original" | "openrouter-fallback" | "opencode-fallback" | "unique-match"
/**
 * Isolated non-publication compatibility only. Never produced by
 * `selectModelsDevRecord` or `selectModelsDevRecordDetailed`, and never
 * eligible for trusted publication or models.dev price fallback.
 */
 | "legacy-family-compatibility";
export interface SelectedModelRecord {
    providerID: string;
    modelID: string;
    record: ModelsDevRecord;
    matchedCandidate?: string;
    matchKind?: ModelsDevMatchKind;
    selectionSource?: ModelsDevSelectionSource;
    /**
     * Canonical identity the matched record declares via a deterministic
     * relation (`canonical_model_id` ?? `base_model`), when present. Used to
     * prove canonical-original selection; never a name heuristic.
     */
    recordCanonicalID?: string;
}
/** Compatibility projection of the selected model metadata. */
export declare function canUseSelectedModelsDevPrice(selected: SelectedModelRecord | undefined): boolean;
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
/**
 * Conservative canonicalization for identity matching only. It deliberately does
 * not strip semantic suffixes such as "-free", dates, sizes, or provider tiers.
 */
export declare function canonicalModelID(value: string): string;
/** Compatibility projection of the selected model metadata. */
export interface RecordRelationTargets {
    /** Preferred canonical identity the record declares, route prefix kept. */
    readonly canonical?: string;
    /** Additional identity relation targets, route-prefixed values only. */
    readonly other: readonly string[];
}
export declare function relationTargets(record: ModelsDevRecord): RecordRelationTargets;
export declare function candidateModelIDs(group: DeploymentGroup): string[];
/**
 * Non-publication compatibility helper. Returns a name-prefix provider guess
 * and never participates in trusted identity resolution.
 */
export declare function legacyFamilyCompatibilityProvider(group: DeploymentGroup): string | undefined;
/** Compatibility projection of the selected model metadata. */
export declare function selectModelsDevRecord(group: DeploymentGroup, catalog: unknown): SelectedModelRecord | undefined;
/**
 * Explicit reasoning support; options never imply support.
 */
export declare function modelsDevReasoning(selected: SelectedModelRecord | undefined): boolean | undefined;
export declare function resolveReasoningSupport(group: DeploymentGroup, selected: SelectedModelRecord | undefined): ReasoningSupportResolution;
/** Compatibility projection of the selected model metadata. */
export declare function buildVariants(selected: SelectedModelRecord | undefined, protocol: Protocol): ModelVariant[];
export declare function releaseTimestamp(selected: SelectedModelRecord | undefined): number;
/** Unknown-aware capability state: `unknown` means no trusted evidence. */
export type CapabilityState = "supported" | "unsupported" | "unknown";
export interface ReasoningStateResolution {
    readonly state: CapabilityState;
    readonly source: ReasoningSupportSource;
    readonly conflict: boolean;
}
/** Compatibility projection of the selected model metadata. */
export declare function resolveReasoningState(group: DeploymentGroup, selected: SelectedModelRecord | undefined): ReasoningStateResolution;
export interface ReasoningLevelsResolution {
    /** Whether level metadata was explicitly declared (possibly empty). */
    readonly known: boolean;
    /** Selectable level ids; empty is legal alongside supported reasoning. */
    readonly values: readonly string[];
}
/** Compatibility projection of the selected model metadata. */
export declare function resolveReasoningLevels(selected: SelectedModelRecord | undefined, protocol: Protocol): ReasoningLevelsResolution;
export type SelectionOutcomeKind = "matched" | "unmatched" | "ambiguous";
export interface DetailedSelection {
    readonly outcome: SelectionOutcomeKind;
    readonly selected?: SelectedModelRecord;
    readonly candidates: readonly string[];
    /** How many provider records matched the deciding candidate. */
    readonly matchCount: number;
    /** Provider ids involved when the outcome is ambiguous. */
    readonly ambiguousProviders: readonly string[];
}
/** Compatibility projection of the selected model metadata. */
/** Deprecated compatibility helper: provider declarations no longer affect metadata. */
export declare function groupExplicitProviderConflict(_group: DeploymentGroup): {
    providers: string[];
} | undefined;
export type GroupIdentityStatus = "known" | "unknown" | "conflict";
export interface GroupIdentityEvidence {
    readonly status: GroupIdentityStatus;
    /** Deterministic stable identity; defined iff `status === "known"`. */
    readonly identity?: string;
    /** Why the group cannot be trusted; defined for unknown/conflict. */
    readonly reason?: string;
}
/** Compatibility projection of the selected model metadata. */
export declare function groupIdentityEvidence(group: DeploymentGroup, _catalog: unknown): GroupIdentityEvidence;
/**
 * Compatibility wrapper over `groupIdentityEvidence`.
 */
export declare function groupIdentityConflict(group: DeploymentGroup, catalog: unknown): string | undefined;
/** Compatibility projection of the selected model metadata. */
export declare function selectModelsDevRecordDetailed(group: DeploymentGroup, catalog: unknown): DetailedSelection;
/** Existing declaration aggregation used only when no record is selected. */
export declare function aggregateTriState(deploymentValues: readonly (boolean | undefined)[], modelLevel?: boolean): {
    state: CapabilityState;
    conflict: boolean;
    source: "litellm" | "models.dev" | "derived" | "default";
};
export interface InheritedRecord {
    /** Effective record after deterministic inheritance. */
    readonly record: ModelsDevRecord;
    /** Provenance chain, e.g. `canonical: xiaomi/mimo-v2.6-pro`. */
    readonly chain: readonly string[];
    /** Field names inherited from another declared identity. */
    readonly inheritedFields: readonly string[];
}
/** Compatibility projection of the selected model metadata. */
export declare function resolveInheritedRecord(selected: SelectedModelRecord | undefined, catalog: unknown): InheritedRecord | undefined;
