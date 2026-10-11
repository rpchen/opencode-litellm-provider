import { type DeploymentGroup, type LiteLLMDeployment } from "./litellm.js";
import { type SelectedModelRecord } from "./modelsdev.js";
export interface FieldEvidence {
    readonly source: EvidenceSource;
    readonly origin: EvidenceOrigin;
    readonly value: FieldEvidenceValue;
    readonly detail?: string;
}
export interface FieldResolution {
    readonly field: string;
    readonly status: FieldResolutionStatus;
    readonly value?: FieldEvidenceValue;
    readonly selectedSource: EvidenceSource;
    readonly resolution: string;
    readonly evidence: readonly FieldEvidence[];
}
export interface RuntimeConstraintKeys {
    readonly context: readonly string[];
    readonly input: readonly string[];
    readonly output: readonly string[];
    readonly modalityFlags: readonly string[];
}
export interface PublicationFieldDescriptor {
    readonly field: string;
    readonly descriptiveKeys: readonly string[];
    readonly constraintKeys: readonly string[];
    readonly intrinsicPointer: string;
}
export interface NumericFieldInput {
    readonly field: "context" | "input" | "output";
    readonly group: DeploymentGroup;
    readonly intrinsic?: number;
    readonly intrinsicDetail?: string;
    readonly intrinsicAuthority?: IntrinsicAuthority;
    readonly bounds?: readonly number[];
}
export interface NumericFieldResolution {
    readonly resolution: FieldResolution;
    readonly value: number | undefined;
    readonly known: boolean;
    readonly missing: boolean;
    readonly unknown: boolean;
    readonly illegal: boolean;
    readonly conflict: boolean;
    readonly discrepancy: boolean;
}
export interface BooleanFieldInput {
    readonly field: string;
    readonly descriptiveKey: string;
    readonly constraintKey?: string;
    readonly group: DeploymentGroup;
    readonly intrinsic?: boolean;
    readonly intrinsicDetail?: string;
    readonly intrinsicAuthority?: IntrinsicAuthority;
    readonly fallbackState: "supported" | "unsupported" | "unknown";
    readonly fallbackConflict: boolean;
}
export interface BooleanFieldResolution {
    readonly resolution: FieldResolution;
    readonly state: "supported" | "unsupported" | "unknown";
    readonly conflict: boolean;
    readonly discrepancy: boolean;
}
export interface ModalityDimension {
    readonly key: string;
    readonly modality: string;
}
export interface ModalityFieldInput {
    readonly direction: "input" | "output";
    readonly group: DeploymentGroup;
    readonly intrinsic?: readonly string[];
    readonly intrinsicDetail?: string;
    readonly intrinsicAuthority?: IntrinsicAuthority;
}
export interface ModalityFieldResolution {
    readonly resolution: FieldResolution;
    readonly values: readonly string[];
    readonly known: boolean;
    readonly discrepancy: boolean;
    readonly conflict: boolean;
}
export type EvidenceSource = "litellm" | "models.dev" | "derived" | "none";
export type EvidenceOrigin = "authoritative-intrinsic" | "fallback-serving" | "descriptive-metadata" | "deployment-constraint" | "unknown-provenance";
export type FieldEvidenceValue = string | number | boolean | readonly string[];
export type FieldResolutionStatus = "selected" | "resolved-discrepancy" | "unresolved-conflict" | "unknown" | "missing" | "illegal";
export type IntrinsicAuthority = "authoritative" | "fallback-serving";
export declare const RUNTIME_CONSTRAINT_KEYS: RuntimeConstraintKeys;
export declare const NUMERIC_FIELD_DESCRIPTORS: Readonly<Record<"context" | "input" | "output", PublicationFieldDescriptor>>;
export declare const INPUT_MODALITY_DIMENSIONS: readonly ModalityDimension[];
export declare const OUTPUT_MODALITY_DIMENSIONS: readonly ModalityDimension[];
export declare function modalityDimensions(direction: "input" | "output"): readonly ModalityDimension[];
export declare function isResolvedDiscrepancy(resolution: FieldResolution): boolean;
export declare function isUnresolvedConflict(resolution: FieldResolution): boolean;
export declare function deploymentNumericValue(deployment: LiteLLMDeployment, descriptor: PublicationFieldDescriptor): {
    value: number;
    origin: EvidenceOrigin;
    key: string;
} | undefined;
export declare function deploymentNumericEvidence(group: DeploymentGroup, descriptor: PublicationFieldDescriptor): readonly FieldEvidence[];
export declare function deploymentConstraintValue(_group: DeploymentGroup, _keys: readonly string[]): number | undefined;
export declare function modelsDevNumeric(selected: SelectedModelRecord | undefined, pointer: string): number | undefined;
export declare function resolveNumericField(input: NumericFieldInput): NumericFieldResolution;
export declare function resolveBooleanField(input: BooleanFieldInput): BooleanFieldResolution;
export declare function resolveModalityField(input: ModalityFieldInput): ModalityFieldResolution;
export declare function materialDiscrepancies(resolutions: readonly FieldResolution[]): readonly FieldResolution[];
export declare function materialConflicts(resolutions: readonly FieldResolution[]): readonly FieldResolution[];
