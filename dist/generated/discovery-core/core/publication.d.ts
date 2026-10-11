/** Publication and recovery use the selected whole-record configuration. */
import { type BuildOptions, type ModelSpec } from "./build.js";
import type { FieldResolution } from "./evidence.js";
import { type DeploymentGroup } from "./litellm.js";
import { aggregateTriState, type CapabilityState, type DetailedSelection, type SelectedModelRecord } from "./modelsdev.js";
import { resolveModel, toModelSpec, type FieldBasis, type ResolvedModel } from "./resolve.js";
export type { CapabilityState };
/** Per-model configuration state. Names are domain semantics, not wire enums. */
export type ModelConfigurationStatus = "configured" | "configured-lkg" | "discovered-incomplete" | "unmatched" | "ambiguous" | "metadata-unavailable" | "invalid-metadata";
/**
 * Why a model is withheld from the host. Several reasons may apply at
 * once (for example an incomplete modality set plus an unresolved limit
 * conflict); the list is never collapsed into one label.
 */
export type WithheldReasonCode = "identity-ambiguous" | "identity-unmatched" | "metadata-unavailable" | "incomplete-metadata" | "authoritative-conflict" | "illegal-metadata";
export interface WithheldReason {
    readonly code: WithheldReasonCode;
    readonly message: string;
    readonly fields: readonly string[];
}
/**
 * Withheld reasons for one assessment. Publication state never depends on
 * user acknowledgement; this list exists so the user can see *why* a
 * model is not available and whether a retry can help.
 */
export declare function withheldReasons(assessment: CompletenessAssessment): readonly WithheldReason[];
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
    readonly resolution?: FieldResolution;
    readonly discrepancy?: boolean;
}
export interface ReasoningAssessment {
    readonly state: CapabilityState;
    readonly levelsKnown: boolean;
    readonly levels: readonly string[];
    readonly provenance: PublicationFieldProvenance;
    readonly levelsProvenance: PublicationFieldProvenance;
    readonly conflict: boolean;
    readonly resolution?: FieldResolution;
    readonly discrepancy?: boolean;
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
    /** Evidence resolution for this dimension, including any resolved discrepancy. */
    readonly resolution: FieldResolution;
    /** Deprecated compatibility field; selected records are never merged. */
    readonly discrepancy: boolean;
    /** Deprecated compatibility field; runtime constraints no longer narrow metadata. */
    readonly deploymentConstraint?: number;
}
export interface ModalityAssessment {
    readonly values: readonly string[];
    /** False means no complete evidence exists for this direction. */
    readonly known: boolean;
    readonly provenance: PublicationFieldProvenance;
    readonly resolution: FieldResolution;
    readonly discrepancy: boolean;
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
    /** Recorded value differences that source authority already resolved. */
    readonly discrepancies: readonly FieldResolution[];
    /** Genuine conflicts that no authority can decide; these withhold the model. */
    readonly conflicts: readonly FieldResolution[];
    readonly failure?: MetadataFailure;
    readonly usingLKG: boolean;
    readonly lkgDetail?: string;
    readonly resolvedIdentity?: ResolvedModel["identity"];
    readonly metadataSource?: {
        readonly providerID: string;
        readonly recordID: string;
        readonly canonicalModelID?: string;
    };
    readonly catalogKind?: ResolvedModel["catalogKind"];
    readonly reasoningLevelsState?: "unknown" | "known";
}
export interface AssessInput {
    readonly catalogAvailable: boolean;
    readonly failure?: MetadataFailure;
}
/**
 * Assess one deployment group for normal publication.
 *
 * Pure derivation of the single `ResolvedModel`: it never fills defaults to
 * hide gaps and never guesses from names or families.
 */
export declare function assessModelConfiguration(group: DeploymentGroup, catalog: unknown, options: BuildOptions, input?: AssessInput): CompletenessAssessment;
export declare function assessmentFromResolved(resolved: ResolvedModel, failure?: MetadataFailure): CompletenessAssessment;
/** True only for `configured` and `configured-lkg`. This is the whole gate. */
export declare function isNormallyPublishable(status: ModelConfigurationStatus): boolean;
/** Schema 9 stores whole critical configuration; old policy caches require refresh. */
export declare const PUBLICATION_SCHEMA_VERSION: 9;
export interface LastKnownGoodCapabilityVerdict {
    readonly tools: CapabilityState;
    readonly reasoning: CapabilityState;
    readonly inputModalitiesKnown: boolean;
    readonly outputModalitiesKnown: boolean;
    /** Captured modality sets must match the stored configuration. */
    readonly inputModalities: readonly string[];
    readonly outputModalities: readonly string[];
    /** Captured context, optional input capacity and output match the stored spec. */
    readonly context: number;
    readonly input: number;
    readonly output: number;
}
export interface LastKnownGoodEntry {
    readonly schemaVersion: typeof PUBLICATION_SCHEMA_VERSION;
    /** Stable LiteLLM model name this entry was captured for. */
    readonly modelName: string;
    /** Integrity of identity, protocol and critical configuration only. */
    readonly configurationFingerprint: string;
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
 * `spec` supplies the input limit; when omitted, `input` is `0`.
 */
export declare function capturedPublicationVerdict(assessment: CompletenessAssessment, spec?: ModelSpec): LastKnownGoodCapabilityVerdict;
/**
 * Capture an LKG entry. The entry is derived from the SAME resolution that
 * passed the publication gate (5.3): callers pass the catalog and options
 * so Core resolves once and captures from that result. A `withheld`,
 * incomplete, or non-`configured` resolution throws instead of failing
 * silently through drift.
 *
 * The legacy `(group, selected, spec, now, captured)` adapter form keeps
 * working only when `catalog` + `options` are also supplied; otherwise it
 * throws. Adapters migrate their seeding to pass the live catalog/options
 * (downstream tasks).
 */
export declare function createLastKnownGoodEntry(group: DeploymentGroup, selected: SelectedModelRecord | undefined, spec: ModelSpec, now?: number, captured?: LastKnownGoodCapabilityVerdict, catalog?: unknown, options?: BuildOptions): LastKnownGoodEntry;
/**
 * Re-prove that a stored snapshot still satisfies the current publication
 * completeness policy AND describes the very spec it would restore.
 */
export declare function validateCapturedPublication(entry: Pick<LastKnownGoodEntry, "spec" | "captured">): {
    valid: boolean;
    reason: string;
};
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
/** Publication and recovery use the selected whole-record configuration. */
export declare function validateLastKnownGood(entry: LastKnownGoodEntry, group: DeploymentGroup, selected: SelectedModelRecord | undefined, now?: number, options?: BuildOptions, catalog?: unknown): LKGValidation;
export declare function resolveConfigurationWithLKG(assessment: CompletenessAssessment, group: DeploymentGroup, catalog: unknown, options: BuildOptions, store: LastKnownGoodStore, now?: number): ConfigurationWithLKG;
export declare function describeAssessment(assessment: CompletenessAssessment): string;
export interface PublishableEntry {
    readonly spec: ModelSpec;
    readonly assessment: CompletenessAssessment;
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
    /** Classified metadata failure when the catalog itself failed to load. */
    readonly failure?: MetadataFailure;
    readonly now?: number;
}
/**
 * Partition discovery output for adapters. Derived from the single
 * resolver: publishable specs equal `toModelSpec(resolved)`.
 *
 * Publishable entries are `configured` and `configured-lkg` only, and
 * nothing else. There is no user confirmation, override, or degraded
 * publication path.
 *
 * Adapters must not reimplement this partition; they only map entries to
 * host shapes and still honor the operational-limits guard before host
 * registration.
 */
export declare function buildPublicationResult(litellmResponse: unknown, catalog: unknown, options: BuildOptions, buildOptions?: BuildPublicationOptions): PublicationResult;
/** Host-transport mapping for a publishable reasoning state. Conservative: unknown never reaches here. */
export declare function hostReasoningFlag(assessment: CompletenessAssessment): boolean;
/** Host-transport mapping for a publishable tool state. Conservative-disable when unknown. */
export declare function hostToolsFlag(assessment: CompletenessAssessment, legacyTools: boolean): boolean;
export { aggregateTriState, resolveModel, toModelSpec };
export type { FieldBasis, ResolvedModel };
