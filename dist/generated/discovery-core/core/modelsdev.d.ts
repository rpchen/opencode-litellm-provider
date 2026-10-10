/**
 * Host-independent models.dev record selection and reasoning variant extraction.
 *
 * Canonical catalog model (D3–D5):
 * - Canonical identity is proven only against the canonical registry
 *   (`catalog.models`) through deterministic evidence; see `resolve.ts`.
 * - Serving records are selected only under a proven serving provider
 *   (`models_dev_provider`) by exact parsed-key match; see `resolve.ts`.
 * - Unproven provider records (OpenCode, OpenRouter, unique-match,
 *   first-party, same-name) NEVER supply publication facts. They appear only
 *   as diagnostic candidates.
 * - `resolveInheritedRecord` field inheritance is DELETED: intrinsic facts
 *   come only from the canonical registry entry; a serving record is the
 *   final serving view.
 *
 * This module keeps the shared record-reader helpers and the deprecated
 * selection entry points as thin shims over the single resolver so existing
 * callers keep compiling; new code must use `resolveModel()` directly.
 */
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
/**
 * Whether provider-scoped models.dev pricing can be treated as a plausible
 * fallback for the deployed model. Only proven serving records (explicit
 * provider, and legacy canonical-original) may serve as a price source;
 * reseller/unique fallbacks must never masquerade as route pricing.
 */
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
/**
 * Deterministic canonical relations a provider-scoped record may declare to
 * point at the canonical model it serves. Only `canonical_model_id` /
 * `base_model` carry canonical-namespace meaning; `inherits` /
 * `equivalent_to` / `equivalents` never prove identity (0 occurrences in
 * the real catalog) and are inert.
 */
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
/**
 * Trusted identity resolution (compat shim over the single resolver).
 *
 * Only a proven serving record under a declared `models_dev_provider`,
 * resolved by exact parsed-key match, is returned. Canonical-only identity
 * carries no provider record by design, so this returns `undefined` for it;
 * callers that need canonical identity must use `resolveModel()`.
 */
export declare function selectModelsDevRecord(group: DeploymentGroup, catalog: unknown): SelectedModelRecord | undefined;
/**
 * Trusted-publication reasoning evidence from a record: explicit
 * `reasoning`, else the presence of `reasoning_options`. `undefined` means
 * the record declares nothing.
 */
export declare function modelsDevReasoning(selected: SelectedModelRecord | undefined): boolean | undefined;
export declare function resolveReasoningSupport(group: DeploymentGroup, selected: SelectedModelRecord | undefined): ReasoningSupportResolution;
/**
 * Reasoning variants from a PROVEN serving record's `reasoning_options`.
 * Callers must only pass the resolved serving record; unproven records,
 * `reasoning_effort`, and `allowed_openai_params` never produce variants.
 */
export declare function buildVariants(selected: SelectedModelRecord | undefined, protocol: Protocol): ModelVariant[];
export declare function releaseTimestamp(selected: SelectedModelRecord | undefined): number;
/** Unknown-aware capability state: `unknown` means no trusted evidence. */
export type CapabilityState = "supported" | "unsupported" | "unknown";
export interface ReasoningStateResolution {
    readonly state: CapabilityState;
    readonly source: ReasoningSupportSource;
    readonly conflict: boolean;
}
/**
 * Tri-state reasoning support, independent from variant levels.
 */
export declare function resolveReasoningState(group: DeploymentGroup, selected: SelectedModelRecord | undefined): ReasoningStateResolution;
export interface ReasoningLevelsResolution {
    /** Whether level metadata was explicitly declared (possibly empty). */
    readonly known: boolean;
    /** Selectable level ids; empty is legal alongside supported reasoning. */
    readonly values: readonly string[];
}
/**
 * Reasoning levels from a record's `reasoning_options`. Only meaningful for
 * proven serving records; see `resolve.ts` for the authority rule.
 */
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
/**
 * Group-wide explicit provider evidence. Distinct explicit
 * `models_dev_provider` values inside one deployment group mean the host
 * model identity cannot be stated as one fact: that is a conflict, not a
 * first-deployment choice.
 */
export declare function groupExplicitProviderConflict(group: DeploymentGroup): {
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
/**
 * Group identity evidence. Every deployment must carry positive identity
 * evidence; an identity-less member is never filtered out. `model_name`
 * never substitutes for per-deployment evidence.
 */
export declare function groupIdentityEvidence(group: DeploymentGroup, catalog: unknown): GroupIdentityEvidence;
/**
 * Compatibility wrapper over `groupIdentityEvidence`.
 */
export declare function groupIdentityConflict(group: DeploymentGroup, catalog: unknown): string | undefined;
/**
 * Detailed selection outcome (compat shim over the single resolver).
 *
 * `matched` with a `selected` record happens ONLY for a proven serving
 * provider with an exactly resolved record (`explicit-provider`).
 * Canonical-only identity, unproven providers, relation-only matches,
 * and reseller/unique records never produce a selection.
 */
export declare function selectModelsDevRecordDetailed(group: DeploymentGroup, catalog: unknown): DetailedSelection;
/**
 * Tri-state aggregation for one capability across deployments.
 */
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
/**
 * DELETED (D5): cross-provider field inheritance. Intrinsic facts come only
 * from the canonical registry entry; serving records are final views.
 * Kept as a deprecated stub returning `undefined` so stale callers fail
 * open in the safe direction (no inheritance) instead of crashing.
 *
 * @deprecated Do not use. Resolved by `resolveModel()`; always `undefined`.
 */
export declare function resolveInheritedRecord(selected: SelectedModelRecord | undefined, catalog: unknown): InheritedRecord | undefined;
