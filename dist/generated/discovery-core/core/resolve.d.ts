import { type DeploymentGroup } from "./litellm.js";
import { type Protocol } from "./protocol.js";
import type { ModelSpec } from "./build.js";
export type FieldBasis = "serving" | "canonical" | "litellm-declared" | "unknown" | "enforcement-narrowed";
export type IdentityStatus = "proven" | "unproven" | "ambiguous" | "conflict";
export type IdentityEvidenceKind = "qualified-deployment" | "registry-unique" | "serving-relation" | "none";
export type ServingStatus = "declared" | "declared-unmatched" | "serving-record-unresolved" | "serving-ambiguous" | "unproven";
export type IdentityKind = "canonical" | "litellm-only" | "serving-only";
export interface ResolvedIdentity {
    readonly status: IdentityStatus;
    readonly canonicalModelID?: string;
    readonly evidence: IdentityEvidenceKind;
    readonly reason?: string;
    readonly parse: {
        readonly adapterSegment?: string;
        readonly customLLMProvider?: string;
    };
    /** Route-vs-base_model difference is diagnostic only. */
    readonly routeDiffers?: boolean;
}
export interface ResolvedServing {
    readonly status: ServingStatus;
    readonly providerID?: string;
    readonly recordID?: string;
    readonly record?: Record<string, unknown>;
    readonly reason?: string;
}
export interface FieldResolutionWithBasis {
    readonly field: string;
    readonly basis: FieldBasis;
    readonly value?: number | boolean | readonly string[];
    readonly status: "selected" | "resolved-discrepancy" | "unresolved-conflict" | "unknown" | "missing" | "illegal";
    readonly resolution: string;
    readonly discrepancy: boolean;
    readonly conflict: boolean;
}
export interface ReasoningLevelsState {
    readonly state: "unknown" | "known";
    readonly values: readonly string[];
    /** Operator-configured effort, diagnostic only. */
    readonly operatorDefaultEffort?: string;
    /** Concrete variants for the resolved protocol (effort or budget settings). */
    readonly variants: ReadonlyArray<{
        readonly id: string;
        readonly settings: Record<string, unknown>;
    }>;
}
export interface DiagnosticCandidate {
    readonly providerID: string;
    readonly recordID: string;
    readonly why: string;
}
export interface LKGProof {
    readonly deploymentEvidence: ReadonlyArray<{
        readonly deploymentID: string;
        readonly normalizedInputs: readonly string[];
        readonly identityKind: IdentityKind;
        readonly canonicalModelID?: string;
        readonly canonicalEvidenceKind?: "qualified-deployment" | "registry-unique" | "serving-relation";
    }>;
    readonly registryDigest?: string;
    readonly serving?: {
        readonly providerID: string;
        readonly recordID: string;
        readonly declarations: ReadonlyArray<{
            readonly deploymentID: string;
            readonly declared: string;
        }>;
        readonly recordDigest: string;
    };
    readonly fields: Readonly<Record<string, FieldBasis>>;
    readonly enforcementFingerprint: string;
    readonly litellmFingerprint?: string;
}
export interface ResolvedModel {
    readonly group: DeploymentGroup;
    readonly protocol: Protocol;
    readonly catalogKind: "complete" | "providers-only" | "unavailable";
    readonly identity: ResolvedIdentity;
    readonly serving: ResolvedServing;
    readonly fields: Readonly<Record<string, FieldResolutionWithBasis>>;
    readonly reasoningLevels: ReasoningLevelsState;
    readonly diagnosticCandidates: readonly DiagnosticCandidate[];
    readonly operatorConfigurationKeys: readonly string[];
    /** Non-positive operator-configuration limit keys (diagnostics only; never gate evidence — D7a/G20d). */
    readonly operatorConfigurationIssueKeys: readonly string[];
    readonly status: "configured" | "discovered-incomplete" | "unmatched" | "ambiguous" | "metadata-unavailable" | "invalid-metadata";
    readonly publishable: boolean;
    readonly reasons: readonly string[];
    readonly discrepancies: readonly FieldResolutionWithBasis[];
    readonly conflicts: readonly FieldResolutionWithBasis[];
    readonly proof: LKGProof;
    readonly spec: ModelSpec;
    readonly release: {
        readonly released: number;
        readonly releaseUnit: "unix-ms" | "unknown" | "none";
    };
}
/** `litellm_params` keys that are Operator-Declared Pricing (D8), never enforcement. */
export declare const MIRRORED_PRICING_KEYS: readonly ["input_cost_per_token", "output_cost_per_token", "input_cost_per_character", "output_cost_per_character", "cache_read_input_token_cost", "cache_creation_input_token_cost", "tiered_pricing"];
export interface ResolveOptions {
    readonly protocolOverrides?: Readonly<Record<string, Protocol>>;
    readonly contextTierCap?: boolean;
}
export declare function resolveModel(group: DeploymentGroup, catalogInput: unknown, options?: ResolveOptions): ResolvedModel;
export declare function toModelSpec(resolved: Omit<ResolvedModel, "spec"> & {
    spec?: ModelSpec;
}): ModelSpec;
