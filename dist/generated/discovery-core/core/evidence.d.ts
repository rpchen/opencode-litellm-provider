/**
 * Evidence provenance, source authority, and discrepancy resolution.
 *
 * Single business source of truth for answering: given several sources
 * that describe the same fact, which one is allowed to decide, and is
 * the remaining difference a *resolved discrepancy* or a genuine
 * *unresolved conflict*?
 *
 * Two different kinds of fact are kept apart on purpose:
 *
 * - **Intrinsic model metadata** (context, output, modalities, tools,
 *   reasoning) describes the model itself. Once canonical identity is
 *   reliably resolved, the trusted models.dev record is the
 *   authoritative source. LiteLLM `model_info` values for the same
 *   dimension are *descriptive* secondary evidence: a difference is a
 *   recorded discrepancy, never an automatic conflict.
 * - **Deployment runtime constraints** are enforced by the endpoint
 *   itself. They may only narrow an effective value. They are proven
 *   from the operator's own deployment configuration (`litellm_params`),
 *   never inferred from a field name inside descriptive `model_info`.
 *
 * No I/O, no timers, no host SDK imports.
 */
import { type DeploymentGroup, type LiteLLMDeployment } from "./litellm.js";
import type { SelectedModelRecord } from "./modelsdev.js";
export type EvidenceSource = "litellm" | "models.dev" | "derived" | "none";
/**
 * Where one evidence item came from, independent of which source served it.
 *
 * `deployment-constraint` is the only origin allowed to narrow an
 * effective value against authoritative intrinsic metadata.
 */
export type EvidenceOrigin = "authoritative-intrinsic" | "fallback-serving" | "descriptive-metadata" | "deployment-constraint" | "unknown-provenance";
export type FieldEvidenceValue = string | number | boolean | readonly string[];
export interface FieldEvidence {
    readonly source: EvidenceSource;
    readonly origin: EvidenceOrigin;
    readonly value: FieldEvidenceValue;
    /** Field key or record pointer this evidence was read from. */
    readonly detail?: string;
}
export type FieldResolutionStatus = 
/** One source decides and no other source disagrees. */
"selected"
/** Authority decided; lower-authority evidence disagreed and is retained. */
 | "resolved-discrepancy"
/** Same-level evidence disagrees and no authority can decide. */
 | "unresolved-conflict"
/** Declared evidence is incomplete; unknown is never coerced to a value. */
 | "unknown"
/** No source declares the fact at all. */
 | "missing"
/** A declared value is illegal (non-positive limit, malformed shape). */
 | "illegal";
export interface FieldResolution {
    readonly field: string;
    readonly status: FieldResolutionStatus;
    readonly value?: FieldEvidenceValue;
    readonly selectedSource: EvidenceSource;
    /** Human-readable authority rule that produced the verdict. */
    readonly resolution: string;
    readonly evidence: readonly FieldEvidence[];
}
export declare function isResolvedDiscrepancy(resolution: FieldResolution): boolean;
export declare function isUnresolvedConflict(resolution: FieldResolution): boolean;
/**
 * LiteLLM keys inside the operator's own deployment configuration
 * (`litellm_params`) that the endpoint provably enforces for a request.
 *
 * D7a (frozen): the proven set starts EMPTY. No non-pricing `litellm_params`
 * key has passed the promotion gate (exact source path + negative breaching
 * test via an OpenSpec delta), so no key narrows any field. Every
 * non-pricing `litellm_params` key is operator configuration (diagnostic
 * only). The seven `MirroredPricingParams` price keys are Operator-Declared
 * Pricing governed by the Price authority, never by this matrix.
 *
 * `model_info` mirrors descriptive registry values; a field with the same
 * name there is declared-observable evidence, never proof of enforcement.
 */
export interface RuntimeConstraintKeys {
    readonly context: readonly string[];
    readonly input: readonly string[];
    readonly output: readonly string[];
    /** Modality flags: only an explicit `false` can narrow a modality set. */
    readonly modalityFlags: readonly string[];
}
export declare const RUNTIME_CONSTRAINT_KEYS: RuntimeConstraintKeys;
export interface PublicationFieldDescriptor {
    readonly field: string;
    /** Descriptive `model_info` keys, in precedence order. */
    readonly descriptiveKeys: readonly string[];
    /** `litellm_params` keys that prove the endpoint enforces the constraint. */
    readonly constraintKeys: readonly string[];
    /** models.dev record pointer that carries the authoritative intrinsic value. */
    readonly intrinsicPointer: string;
}
export declare const NUMERIC_FIELD_DESCRIPTORS: Readonly<Record<"context" | "input" | "output", PublicationFieldDescriptor>>;
/** Read a numeric field from `litellm_params` (deployment constraint) first, then `model_info`. */
export declare function deploymentNumericValue(deployment: LiteLLMDeployment, descriptor: PublicationFieldDescriptor): {
    value: number;
    origin: EvidenceOrigin;
    key: string;
} | undefined;
/** Every explicitly declared deployment-level value with its provenance. */
export declare function deploymentNumericEvidence(group: DeploymentGroup, descriptor: PublicationFieldDescriptor): readonly FieldEvidence[];
/** Narrowest proven deployment constraint for a limit dimension. */
export declare function deploymentConstraintValue(group: DeploymentGroup, keys: readonly string[]): number | undefined;
export declare function modelsDevNumeric(selected: SelectedModelRecord | undefined, pointer: string): number | undefined;
export interface NumericFieldInput {
    readonly field: "context" | "input" | "output";
    readonly group: DeploymentGroup;
    /**
     * Trusted models.dev value. Only pass a value when canonical identity is
     * reliably resolved; otherwise models.dev carries no authority here.
     */
    readonly intrinsic?: number;
    readonly intrinsicDetail?: string;
    /**
     * Authority of the intrinsic value. `authoritative` (default) decides
     * against lower-authority LiteLLM declarations; `fallback-serving` is
     * reseller serving metadata of a fallback-selected record: it fills gaps
     * like descriptive metadata and conflicts with it as an unresolved
     * conflict instead of overruling it.
     */
    readonly intrinsicAuthority?: IntrinsicAuthority;
    /** Extra narrowing bounds that are not resolution evidence (context tier cap). */
    readonly bounds?: readonly number[];
}
export type IntrinsicAuthority = "authoritative" | "fallback-serving";
export interface NumericFieldResolution {
    readonly resolution: FieldResolution;
    /** Effective value to publish; `undefined` when the field is not usable. */
    readonly value: number | undefined;
    readonly known: boolean;
    readonly missing: boolean;
    readonly unknown: boolean;
    readonly illegal: boolean;
    readonly conflict: boolean;
    readonly discrepancy: boolean;
}
/**
 * Resolve one numeric limit dimension.
 *
 * Authority ladder:
 * 1. illegal declared values (any origin) block the field;
 * 2. same-origin declared deployment values that disagree are an
 *    unresolved conflict when no authoritative intrinsic value exists;
 * 3. a trusted intrinsic value decides, and any differing lower-authority
 *    value is retained as a resolved discrepancy;
 * 4. proven deployment constraints then narrow the effective value.
 */
export declare function resolveNumericField(input: NumericFieldInput): NumericFieldResolution;
export interface BooleanFieldInput {
    readonly field: string;
    /** Descriptive `model_info` key. */
    readonly descriptiveKey: string;
    /** `litellm_params` key proving an enforced constraint, when one exists. */
    readonly constraintKey?: string;
    readonly group: DeploymentGroup;
    /** Trusted models.dev verdict; only pass when identity is reliably resolved. */
    readonly intrinsic?: boolean;
    readonly intrinsicDetail?: string;
    /** Authority of the intrinsic verdict (see `resolveNumericField`). */
    readonly intrinsicAuthority?: IntrinsicAuthority;
    /** Legacy tri-state verdict used when no authority exists. */
    readonly fallbackState: "supported" | "unsupported" | "unknown";
    readonly fallbackConflict: boolean;
}
export interface BooleanFieldResolution {
    readonly resolution: FieldResolution;
    readonly state: "supported" | "unsupported" | "unknown";
    readonly conflict: boolean;
    readonly discrepancy: boolean;
}
/**
 * Resolve one boolean capability dimension.
 *
 * A trusted intrinsic verdict decides; contradicting LiteLLM declarations
 * become a resolved discrepancy. Without an intrinsic verdict the legacy
 * tri-state rules apply unchanged (missing evidence stays unknown,
 * same-level disagreement stays an unresolved conflict).
 */
export declare function resolveBooleanField(input: BooleanFieldInput): BooleanFieldResolution;
export interface ModalityDimension {
    readonly key: string;
    readonly modality: string;
}
export declare const INPUT_MODALITY_DIMENSIONS: readonly ModalityDimension[];
export declare const OUTPUT_MODALITY_DIMENSIONS: readonly ModalityDimension[];
export declare function modalityDimensions(direction: "input" | "output"): readonly ModalityDimension[];
export interface ModalityFieldInput {
    readonly direction: "input" | "output";
    readonly group: DeploymentGroup;
    /** Authoritative intrinsic modality list; only pass with a trusted identity. */
    readonly intrinsic?: readonly string[];
    readonly intrinsicDetail?: string;
    /** Authority of the intrinsic list (see `resolveNumericField`). */
    readonly intrinsicAuthority?: IntrinsicAuthority;
}
export interface ModalityFieldResolution {
    readonly resolution: FieldResolution;
    /** Selected modality set when known, in a stable declaration order. */
    readonly values: readonly string[];
    readonly known: boolean;
    /** True when lower-authority LiteLLM declarations disagreed and were retained. */
    readonly discrepancy: boolean;
    readonly conflict: boolean;
}
/**
 * Resolve one modality direction.
 *
 * With a trusted intrinsic list the direction is known and the intrinsic
 * set decides; contradicting LiteLLM flags are a resolved discrepancy. A
 * proven deployment constraint (`litellm_params` flag explicitly `false`)
 * removes a modality from the effective set. Without authority the legacy
 * sparse-flag rules apply: only a documented complete set makes the
 * direction known.
 */
export declare function resolveModalityField(input: ModalityFieldInput): ModalityFieldResolution;
/** Recorded value differences that authority already resolved. */
export declare function materialDiscrepancies(resolutions: readonly FieldResolution[]): readonly FieldResolution[];
/** Genuine conflicts that block publication. */
export declare function materialConflicts(resolutions: readonly FieldResolution[]): readonly FieldResolution[];
