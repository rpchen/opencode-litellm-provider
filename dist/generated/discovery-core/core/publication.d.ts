/**
 * Trusted model-capability publication loop.
 *
 * Single business source of truth for answering: "is this discovered
 * model's metadata reliable enough to publish as a fully configured
 * model?" Covers completeness/publishability policy, false-vs-unknown
 * semantics, reasoning/levels decoupling, deterministic inheritance,
 * failure taxonomy, TTL-free Last Known Good, explicit degradation,
 * configuration states, and field-level provenance.
 *
 * No I/O, no timers, no host SDK imports. Adapters consume the verdicts
 * without reimplementing policy.
 */
import { type ModelLimits } from "./capabilities.js";
import { type CapabilityState, type DetailedSelection, type SelectedModelRecord } from "./modelsdev.js";
import { type DeploymentGroup } from "./litellm.js";
import { type BuildOptions, type ModelSpec } from "./build.js";
export type { CapabilityState };
/** Per-model configuration state. Names are domain semantics, not wire enums. */
export type ModelConfigurationStatus = "configured" | "configured-lkg" | "discovered-incomplete" | "unmatched" | "ambiguous" | "metadata-unavailable" | "invalid-metadata" | "degraded";
export type MetadataFailureKind = "timeout" | "server-5xx" | "unreachable" | "not-found" | "ambiguous" | "missing-field" | "illegal-value" | "schema-incompatible" | "cached" | "recovered-after-retry";
export interface MetadataFailure {
    readonly kind: MetadataFailureKind;
    /** Whether retrying the same fetch may succeed. */
    readonly retryable: boolean;
    readonly detail?: string;
    readonly httpStatus?: number;
}
/** Pure classification of a metadata fetch/merge failure. Never emits defaults. */
export declare function classifyMetadataFailure(error: unknown): MetadataFailure;
export declare function metadataFailureFor(kind: MetadataFailureKind, detail?: string): MetadataFailure;
export type ProvenanceSource = "override" | "litellm" | "models.dev" | "derived" | "default" | "none" | "lkg" | "canonical-inheritance";
export interface PublicationFieldProvenance {
    readonly source: ProvenanceSource;
    readonly detail?: string;
}
export interface ToolAssessment {
    readonly state: CapabilityState;
    readonly provenance: PublicationFieldProvenance;
}
export interface ReasoningAssessment {
    readonly state: CapabilityState;
    readonly levelsKnown: boolean;
    readonly levels: readonly string[];
    readonly provenance: PublicationFieldProvenance;
    readonly levelsProvenance: PublicationFieldProvenance;
    readonly conflict: boolean;
}
export interface LimitAssessment {
    /** Positive agreed value when known; otherwise 0, never a usable default. */
    readonly value: number;
    readonly valid: boolean;
    readonly missing: boolean;
    readonly unknown: boolean;
    readonly conflict: boolean;
    readonly illegal: boolean;
    readonly provenance: PublicationFieldProvenance;
}
export interface ModalityAssessment {
    readonly values: readonly string[];
    /** False means the text-only baseline is used without explicit evidence. */
    readonly known: boolean;
    readonly provenance: PublicationFieldProvenance;
}
export interface CompletenessAssessment {
    readonly publishable: boolean;
    readonly status: ModelConfigurationStatus;
    readonly tools: ToolAssessment;
    readonly reasoning: ReasoningAssessment;
    readonly context: LimitAssessment;
    readonly output: LimitAssessment;
    readonly inputModalities: ModalityAssessment;
    readonly outputModalities: ModalityAssessment;
    readonly identity: DetailedSelection;
    readonly inheritedFields: readonly string[];
    readonly inheritanceChain: readonly string[];
    readonly missingFields: readonly string[];
    readonly unknownFields: readonly string[];
    readonly illegalFields: readonly string[];
    /** Fields whose deployment/model-level evidence contradicts itself. */
    readonly conflictFields: readonly string[];
    readonly failure?: MetadataFailure;
    readonly usingLKG: boolean;
    readonly lkgDetail?: string;
}
type ScalarEvidenceState = "known" | "unknown" | "conflict";
export interface ScalarEvidence {
    readonly state: ScalarEvidenceState;
    /** The agreed value when known; 0 otherwise. */
    readonly value: number;
    readonly conflict: boolean;
    readonly source: "litellm" | "models.dev" | "derived" | "none";
}
/**
 * Scalar group aggregation preserving unknown and conflict. Never drops
 * missing declarations: `value + unknown` stays unknown. Deployment
 * disagreement and same-dimension deployment-vs-model-level disagreement
 * are conflicts, not silently-minimum merges.
 *
 * `modelLevelAuthoritative` marks fields where the model-level value is a
 * distinct, more precise dimension (context): there it decides known on
 * its own and never conflicts with deployment inputs.
 */
export declare function aggregateScalarEvidence(deploymentValues: readonly (number | undefined)[], modelLevel: number | undefined, modelLevelAuthoritative?: boolean): ScalarEvidence;
/**
 * The group's agreed limit value, mirroring exactly what the published
 * spec carries (context capped when `contextTierCap` is enabled).
 * `undefined` when the group evidence is unknown or conflicting.
 */
export declare function agreedLimitValue(group: DeploymentGroup, selected: SelectedModelRecord | undefined, field: "context" | "output", contextTierCap?: boolean): number | undefined;
export interface AssessInput {
    readonly catalogAvailable: boolean;
    readonly failure?: MetadataFailure;
}
/**
 * Assess one deployment group for normal publication.
 *
 * Pure function of already-fetched inputs: it never fills defaults to
 * hide gaps and never guesses from names or families.
 */
export declare function assessModelConfiguration(group: DeploymentGroup, catalog: unknown, options: BuildOptions, input?: AssessInput): CompletenessAssessment;
/** True only for `configured` and `configured-lkg`. Degraded needs its own path. */
export declare function isNormallyPublishable(status: ModelConfigurationStatus): boolean;
/** True for normally publishable states plus user-accepted `degraded`. */
export declare function isPublishableWithDegradedAcceptance(status: ModelConfigurationStatus): boolean;
/**
 * Bumped when publication completeness grows, captured facts change
 * meaning, or the LKG identity shape changes. An older number cannot
 * satisfy a newer policy; restoration also re-checks the captured verdict
 * against the stored spec and the stored stable identity against the
 * current group evidence, so a same-number entry with unknown
 * capabilities, inconsistent facts, or a route-stripped identity still
 * fails closed.
 */
export declare const PUBLICATION_SCHEMA_VERSION: 4;
export interface LastKnownGoodCapabilityVerdict {
    readonly tools: CapabilityState;
    readonly reasoning: CapabilityState;
    readonly inputModalitiesKnown: boolean;
    readonly outputModalitiesKnown: boolean;
    /** Actual modality sets when known, so live evidence can conflict-check them. */
    readonly inputModalities: readonly string[];
    readonly outputModalities: readonly string[];
    /**
     * Captured limit facts used for live conflict detection. Each value is
     * compared only against the same dimension: `context` is total context
     * (models.dev `limit.context`), `input` is input capacity (LiteLLM
     * `max_input_tokens` / models.dev `limit.input`), `output` is the
     * output limit. Never compared across dimensions.
     */
    readonly context: number;
    readonly input: number;
    readonly output: number;
}
export interface LastKnownGoodEntry {
    readonly schemaVersion: typeof PUBLICATION_SCHEMA_VERSION;
    /** Stable LiteLLM model name this entry was captured for. */
    readonly modelName: string;
    /**
     * Provider-aware stable identity of the captured group (sorted union
     * of every deployment's identity ids, `|`-joined). This is the field
     * LKG validity compares — it keeps provider namespaces and works with
     * no enrichment source available. `canonicalID` stays as the legacy
     * route-stripped name for provenance/compatibility only.
     */
    readonly stableIdentity: string;
    /** Legacy route-stripped canonical name; provenance/compatibility only. */
    readonly canonicalID: string;
    readonly providerID: string;
    readonly matchKind?: string;
    readonly fetchedAt: string;
    readonly fetchedAtEpochMs: number;
    readonly spec: ModelSpec;
    /** Completeness verdict captured when the snapshot passed publication policy. */
    readonly captured: LastKnownGoodCapabilityVerdict;
    readonly provenanceDetail: string;
}
export interface LKGValidation {
    readonly valid: boolean;
    readonly reason: string;
    readonly ageMs?: number;
}
export declare function lastKnownGoodKey(modelName: string): string;
/**
 * Capture the publication facts proven by an assessment.
 *
 * `spec` supplies the input limit (the assessment has no input gate);
 * when omitted, `input` is `0` and `createLastKnownGoodEntry` backfills it
 * from the spec it stores, so adapters seeding through the legacy
 * single-argument call keep producing valid entries.
 */
export declare function capturedPublicationVerdict(assessment: CompletenessAssessment, spec?: ModelSpec): LastKnownGoodCapabilityVerdict;
export declare function createLastKnownGoodEntry(group: DeploymentGroup, selected: SelectedModelRecord | undefined, spec: ModelSpec, now?: number, captured?: LastKnownGoodCapabilityVerdict, catalog?: unknown, options?: BuildOptions): LastKnownGoodEntry;
/**
 * Re-prove that a stored snapshot still satisfies the current publication
 * completeness policy AND describes the very spec it would restore.
 * Positive limits alone are not enough: unknown tools, reasoning, or
 * modalities, any illegal captured field, and any mismatch between the
 * captured facts and `entry.spec` (limits, tools, reasoning, modality
 * sets) fail closed. A forged fact that merely parses is still rejected.
 */
export declare function validateCapturedPublication(entry: Pick<LastKnownGoodEntry, "spec" | "captured">): {
    valid: boolean;
    reason: string;
};
/**
 * Validate a stored entry against the current discovery inputs.
 * Age is reported but never a validity condition.
 *
 * Identity validity is decided FIRST from the current deployments'
 * own provider-aware evidence — never from `selected`, which is exactly
 * what a metadata outage removes. `selected` only adds a positive
 * provider cross-check when enrichment is available.
 */
export declare function validateLastKnownGood(entry: LastKnownGoodEntry, group: DeploymentGroup, selected: SelectedModelRecord | undefined, now?: number, options?: Pick<BuildOptions, "contextTierCap">, catalog?: unknown): LKGValidation;
export declare function isLKGEntryCompatible(value: unknown): value is LastKnownGoodEntry;
/** In-memory LKG store. Persistence belongs to adapters; validity belongs here. */
export declare function createLastKnownGoodStore(): {
    set(key: string, entry: LastKnownGoodEntry): void;
    get(key: string): LastKnownGoodEntry | undefined;
    delete(key: string): void;
    clear(): void;
    size(): number;
};
export type LastKnownGoodStore = ReturnType<typeof createLastKnownGoodStore>;
export interface ConfigurationWithLKG {
    readonly assessment: CompletenessAssessment;
    /** Present when a valid LKG entry substitutes for failed live metadata. */
    readonly lkg?: LastKnownGoodEntry;
    readonly lkgValidation?: LKGValidation;
}
/**
 * Resolve the final configuration, substituting valid LKG only when live
 * metadata is incomplete/unavailable AND a provably belonging entry exists
 * whose stored spec itself passes completeness.
 */
export declare function resolveConfigurationWithLKG(assessment: CompletenessAssessment, group: DeploymentGroup, catalog: unknown, options: BuildOptions, store: LastKnownGoodStore, now?: number): ConfigurationWithLKG;
export interface DegradationAcceptance {
    readonly acceptedAt: string;
    readonly reason?: string;
    readonly acceptedFields: readonly string[];
}
export interface DegradedConfiguration {
    readonly status: "degraded";
    readonly assessment: CompletenessAssessment;
    readonly acceptance: DegradationAcceptance;
    /** Still lists every gap; acceptance never erases unknowns. */
    readonly remainingGaps: readonly string[];
}
export type DegradationEligibility = {
    readonly eligible: true;
} | {
    readonly eligible: false;
    readonly reason: string;
};
/**
 * Which blocked states a user may explicitly accept.
 *
 * Only known-identity incompleteness and a failed metadata source are
 * "the user knows what is missing". Ambiguous identity, illegal values,
 * and unmatched identity are different failures and stay blocked.
 */
export declare function degradationEligibility(assessment: CompletenessAssessment): DegradationEligibility;
export declare function isDegradationEligible(assessment: CompletenessAssessment): boolean;
/**
 * User-accepted degradation. The returned wrapper stays `degraded` and
 * keeps every missing/unknown/illegal field listed; it is publishable
 * only through the degraded path, never as `configured`.
 *
 * Ineligible states throw so adapters cannot report a successful accept
 * for ambiguous, invalid, unmatched, or already-configured models.
 */
export declare function acceptDegradedConfiguration(assessment: CompletenessAssessment, acceptance: {
    reason?: string;
    acceptedAt?: string;
}): DegradedConfiguration;
export declare function describeAssessment(assessment: CompletenessAssessment): string;
export interface PublishableEntry {
    readonly spec: ModelSpec;
    readonly assessment: CompletenessAssessment;
    readonly degraded?: DegradedConfiguration;
}
export interface BlockedEntry {
    readonly spec: ModelSpec;
    readonly assessment: CompletenessAssessment;
}
export interface PublicationResult {
    readonly publishable: readonly PublishableEntry[];
    readonly blocked: readonly BlockedEntry[];
    /** Live assessment by model id (before LKG substitution details). */
    readonly assessments: ReadonlyMap<string, CompletenessAssessment>;
}
export interface BuildPublicationOptions {
    readonly store?: LastKnownGoodStore;
    /** Model ids the user explicitly accepted as degraded. */
    readonly acceptedDegradedIDs?: ReadonlySet<string>;
    readonly degradationReason?: string;
    /** Classified metadata failure when the catalog itself failed to load. */
    readonly failure?: MetadataFailure;
    readonly now?: number;
}
/**
 * Partition discovery output for adapters.
 *
 * Publishable entries are `configured`, `configured-lkg`, or
 * user-accepted `degraded` only. Everything else is blocked with its
 * assessment. Adapters must not reimplement this partition; they only
 * map entries to host shapes and still honor the operational-limits
 * guard before host registration.
 */
export declare function buildPublicationResult(litellmResponse: unknown, catalog: unknown, options: BuildOptions, buildOptions?: BuildPublicationOptions): PublicationResult;
/** Host-transport mapping for a publishable reasoning state. Conservative: unknown never reaches here. */
export declare function hostReasoningFlag(assessment: CompletenessAssessment): boolean;
/** Host-transport mapping for a publishable tool state. Conservative-disable when unknown. */
export declare function hostToolsFlag(assessment: CompletenessAssessment, legacyTools: boolean): boolean;
export type { ModelLimits };
