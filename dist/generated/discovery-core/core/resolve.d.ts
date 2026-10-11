/** Model names select one whole models.dev record. No serving-provider proof. */
import type { ModelSpec } from "./build.js";
import { type NormalizedCatalog } from "./catalog-input.js";
import { type DeploymentGroup } from "./litellm.js";
import { type SelectedModelRecord } from "./modelsdev.js";
import { type Protocol } from "./protocol.js";
export type FieldBasis = "models.dev" | "litellm-declared" | "unknown";
export type IdentityStatus = "proven" | "unproven" | "ambiguous";
export type IdentityEvidenceKind = "model-name" | "registry-unique" | "record-relation" | "none";
export interface ResolvedIdentity {
    readonly status: IdentityStatus;
    readonly canonicalModelID?: string;
    readonly evidence: IdentityEvidenceKind;
}
export interface FieldResolutionWithBasis {
    readonly field: string;
    readonly basis: FieldBasis;
    readonly value?: number | boolean | readonly string[];
    readonly status: "selected" | "unresolved-conflict" | "unknown" | "missing" | "illegal";
    readonly resolution: string;
    readonly discrepancy: boolean;
    readonly conflict: boolean;
}
export interface ReasoningLevelsState {
    readonly state: "unknown" | "known";
    readonly values: readonly string[];
    readonly variants: ModelSpec["variants"];
}
export interface ResolvedModel {
    readonly group: DeploymentGroup;
    readonly protocol: Protocol;
    readonly catalogKind: NormalizedCatalog["kind"];
    readonly identity: ResolvedIdentity;
    readonly selected?: SelectedModelRecord;
    readonly fields: Readonly<Record<string, FieldResolutionWithBasis>>;
    readonly reasoningLevels: ReasoningLevelsState;
    readonly status: "configured" | "discovered-incomplete" | "unmatched" | "ambiguous" | "metadata-unavailable" | "invalid-metadata";
    readonly publishable: boolean;
    readonly reasons: readonly string[];
    readonly discrepancies: readonly FieldResolutionWithBasis[];
    readonly conflicts: readonly FieldResolutionWithBasis[];
    readonly spec: ModelSpec;
    readonly release: {
        readonly released: number;
        readonly releaseUnit: "unix-ms" | "unknown" | "none";
    };
}
export interface ResolveOptions {
    readonly protocolOverrides?: Readonly<Record<string, Protocol>>;
    /** Deprecated: accepted for compatibility, ignored. */
    readonly contextTierCap?: boolean;
}
export declare function resolveModel(group: DeploymentGroup, catalogInput: unknown, options?: ResolveOptions): ResolvedModel;
/** Compatibility for callers that already obtained one selected record. */
export declare function resolveSelectedModel(group: DeploymentGroup, selected: SelectedModelRecord | undefined): ResolvedModel;
export declare function toModelSpec(resolved: Omit<ResolvedModel, "spec"> & {
    spec?: ModelSpec;
}): ModelSpec;
