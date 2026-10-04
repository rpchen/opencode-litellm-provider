/**
 * Host-independent models.dev record selection and reasoning variant extraction.
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
export type ModelsDevMatchKind = "exact" | "canonical" | "alias";
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
}
/**
 * Whether provider-scoped models.dev pricing can be treated as a plausible
 * fallback for the deployed model. Gateway/reseller records selected only for
 * capability enrichment must never masquerade as the LiteLLM route price.
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
export declare function candidateModelIDs(group: DeploymentGroup): string[];
/**
 * Non-publication compatibility helper. Returns a name-prefix provider guess
 * and never participates in trusted identity resolution.
 *
 * Callers that need a publishable identity must use
 * `selectModelsDevRecord` / `selectModelsDevRecordDetailed`.
 */
export declare function legacyFamilyCompatibilityProvider(group: DeploymentGroup): string | undefined;
/**
 * Trusted identity resolution. Provider choice uses only verifiable
 * relations: explicit `models_dev_provider`, `canonical_model_id`,
 * alias / equivalent / inherits metadata consumed by matching, OpenRouter,
 * OpenCode, or a genuinely unique remaining record.
 *
 * Model-name prefixes and family substrings never select a provider.
 * Multiple remaining records stay unresolved (`undefined`) so publication
 * can report `ambiguous` instead of guessing.
 */
export declare function selectModelsDevRecord(group: DeploymentGroup, catalog: unknown): SelectedModelRecord | undefined;
/**
 * Trusted model-level reasoning evidence: explicit `reasoning`, else the
 * presence of `reasoning_options`. `undefined` means the record declares
 * nothing. Exported so LKG conflict detection consumes the same source
 * extraction instead of re-deriving it.
 */
export declare function modelsDevReasoning(selected: SelectedModelRecord | undefined): boolean | undefined;
export declare function resolveReasoningSupport(group: DeploymentGroup, selected: SelectedModelRecord | undefined): ReasoningSupportResolution;
export declare function buildVariants(selected: SelectedModelRecord | undefined, protocol: Protocol): ModelVariant[];
export declare function releaseTimestamp(selected: SelectedModelRecord | undefined): number;
/**
 * Trusted-publication additions (see `trusted-model-capability-publication`).
 *
 * The legacy boolean/zero defaults above stay wire-compatible. The helpers
 * below expose the unknown-aware semantics the publication policy needs:
 * tri-state capability states, detailed selection outcomes, and
 * deterministic canonical inheritance with provenance. Nothing here
 * performs I/O or guesses capabilities from names or families.
 */
/** Unknown-aware capability state: `unknown` means no trusted evidence. */
export type CapabilityState = "supported" | "unsupported" | "unknown";
export interface ReasoningStateResolution {
    readonly state: CapabilityState;
    readonly source: ReasoningSupportSource;
    readonly conflict: boolean;
}
/**
 * Tri-state reasoning support, independent from variant levels.
 *
 * Unlike the legacy boolean resolver (which maps "no evidence" to
 * `false`), this resolver reports `unknown` when neither LiteLLM nor
 * models.dev supplies trusted evidence, and when explicit LiteLLM
 * declarations disagree with each other.
 */
export declare function resolveReasoningState(group: DeploymentGroup, selected: SelectedModelRecord | undefined): ReasoningStateResolution;
export interface ReasoningLevelsResolution {
    /** Whether level metadata was explicitly declared (possibly empty). */
    readonly known: boolean;
    /** Selectable level ids; empty is legal alongside supported reasoning. */
    readonly values: readonly string[];
}
/**
 * Reasoning levels decoupled from support. `known=true` with empty
 * `values` means the model reasons without user-selectable grades; it
 * never implies lack of support. `known=false` means no level metadata
 * was declared at all.
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
/**
 * Group-wide identity evidence. Identity is publication-critical like
 * every other capability: the absence of a detected conflict is NOT
 * proof of identity.
 *
 * - `known`: every deployment carries positive identity evidence and all
 *   ids reconcile into one component. `identity` is deterministic and
 *   order-independent — the sorted union of every deployment's
 *   provider-aware ids, joined by `|`. It preserves provider namespaces
 *   (`openai/foo` never collapses to `foo`) and is never derived from
 *   `model_name`, family names, or a sibling deployment's evidence.
 * - `unknown`: one or more deployments declare no identity at all
 *   (no route, no base model, no deterministic provider proof).
 * - `conflict`: deployments provably cannot name the same model.
 *
 * The same evidence serves live selection/publication and LKG
 * capture/restore, so provider-aware publication and LKG matching can
 * never drift apart.
 */
export interface GroupIdentityEvidence {
    readonly status: GroupIdentityStatus;
    /** Deterministic stable identity; defined iff `status === "known"`. */
    readonly identity?: string;
    /** Why the group cannot be trusted; defined for unknown/conflict. */
    readonly reason?: string;
}
/**
 * Group identity evidence. Pure over the group and catalog.
 *
 * Reconciliation runs on the identity equivalence graph: nodes are
 * normalized identity strings (provider namespace preserved), edges come
 * from deployment declarations plus catalog relations
 * (`canonical_model_id`, `aliases`, `equivalent_to`, `equivalents`,
 * `inherits`). Connectivity is symmetric, so the verdict never depends
 * on deployment array order nor on which side of a relation stores the
 * declaration. The graph proves identity membership only — capability
 * values never inherit through it.
 */
export declare function groupIdentityEvidence(group: DeploymentGroup, catalog: unknown): GroupIdentityEvidence;
/**
 * Compatibility wrapper over `groupIdentityEvidence`: any non-known
 * state blocks trusted identity the same way. Prefer the evidence form
 * when the unknown/conflict distinction matters.
 */
export declare function groupIdentityConflict(group: DeploymentGroup, catalog: unknown): string | undefined;
/**
 * Detailed models.dev selection outcome.
 *
 * Trusted precedence is explicit provider > canonical-original >
 * OpenRouter > OpenCode > unique match. Name/family heuristics are not a
 * step. Multiple remaining records stay `ambiguous` instead of collapsing
 * into an arbitrary reseller or a name-prefix provider.
 *
 * Group consistency: distinct explicit `models_dev_provider` values,
 * deployment identities that metadata cannot prove equivalent, or any
 * deployment with no positive identity evidence, make the whole group
 * `ambiguous` — never first-deployment wins, and never a silent pass
 * because no conflict was detected.
 */
export declare function selectModelsDevRecordDetailed(group: DeploymentGroup, catalog: unknown): DetailedSelection;
/**
 * Tri-state aggregation for one capability across deployments.
 *
 * `undefined` is unknown, not a value that can be dropped. A missing
 * deployment declaration therefore cannot turn the group into supported
 * or unsupported. Model-level evidence fills only an entirely unevidenced
 * group; an explicit deployment disagreement with that evidence stays a
 * conflict.
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
 * Deterministic capability inheritance.
 *
 * Only metadata-expressed relations (`canonical_model_id`,
 * `inherits`, `equivalent_to` / `equivalents` naming a
 * `provider/model` identity) may supply missing fields. Name similarity,
 * family membership, or neighbor-model values never inherit. Every
 * inherited field is reported so provenance can name its source.
 */
export declare function resolveInheritedRecord(selected: SelectedModelRecord | undefined, catalog: unknown): InheritedRecord | undefined;
