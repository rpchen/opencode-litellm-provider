import { type BuildOptions, type ModelSpec } from "./build.js";
import { type ReasoningSupportResolution } from "./modelsdev.js";
import { type FieldBasis, type ResolvedModel } from "./resolve.js";
import type { FieldResolution } from "./evidence.js";
import { type ProtocolReason, type ProtocolSupport } from "./protocol.js";
export declare const DISCOVERY_DIAGNOSTICS_SCHEMA_VERSION: 1;
export type DiagnosticSeverity = "info" | "warning" | "error";
export type DiagnosticStage = "model-info" | "models-list" | "models-dev" | "protocol" | "mapping" | "publication";
export type DiagnosticFieldSource = "override" | "litellm" | "models.dev" | "derived" | "default" | "none" | "lkg" | "canonical-inheritance";
export interface DiagnosticIssue {
    readonly severity: DiagnosticSeverity;
    readonly stage: DiagnosticStage;
    readonly code: string;
    readonly message: string;
    readonly modelId?: string;
}
export interface FieldProvenance {
    readonly source: DiagnosticFieldSource;
    readonly detail?: string;
}
export interface MetadataConflictDiagnostic {
    readonly field: string;
    readonly resolution: string;
}
export interface ModelQualityDiagnostic {
    readonly identity: {
        readonly canonicalCandidates: readonly string[];
        readonly matchKind?: "exact" | "canonical" | "alias" | "relation";
        readonly matchedCandidate?: string;
        /**
         * Where the canonical identity evidence comes from: a provider-declared
         * canonical relation, the deployments' own declarations, or nothing
         * provable. Observational only.
         */
        readonly identityProvenance?: "provider-relation" | "deployment-declaration" | "unknown";
        /** Canonical identity from the single resolver (D9, diagnostics 4.3). */
        readonly canonicalModelID?: string;
        readonly canonicalEvidence?: ResolvedModel["identity"]["evidence"];
        readonly canonicalStatus?: ResolvedModel["identity"]["status"];
        readonly adapterSegment?: string;
        readonly customLLMProvider?: string;
    };
    readonly reasoning: ReasoningSupportResolution;
    readonly protocolSupport: ProtocolSupport;
    readonly fallback: "enriched" | "litellm-only";
    readonly conflicts: readonly MetadataConflictDiagnostic[];
    /** Serving status from the single resolver. */
    readonly serving?: {
        readonly status: ResolvedModel["serving"]["status"];
        readonly providerID?: string;
        readonly recordID?: string;
    };
    /** Per-field basis from the single resolver. */
    readonly fieldBasis?: Readonly<Record<string, FieldBasis>>;
    /** Selectable reasoning levels state (unknown vs known). */
    readonly reasoningLevelsState?: "unknown" | "known";
    /** Non-pricing litellm_params keys as operator configuration (never enforcement). */
    readonly operatorConfigurationKeys?: readonly string[];
    /** Unproven exact-id records listed as declaration hints only. */
    readonly diagnosticCandidates?: ReadonlyArray<{
        providerID: string;
        recordID: string;
        why: string;
    }>;
    readonly catalogKind?: ResolvedModel["catalogKind"];
}
export interface ModelDiagnostic {
    readonly id: string;
    readonly deploymentCount: number;
    readonly candidates: readonly string[];
    readonly modelsDev: {
        readonly matched: boolean;
        readonly providerID?: string;
        readonly modelID?: string;
        /** Which precedence step selected this record (observational). */
        readonly selectionSource?: string;
    };
    readonly protocol: {
        readonly value: ModelSpec["protocol"];
        readonly reason: ProtocolReason;
        readonly support: ProtocolSupport;
        readonly deploymentProtocols: readonly ModelSpec["protocol"][];
    };
    readonly quality: ModelQualityDiagnostic;
    readonly publication: {
        readonly status: import("./publication.js").ModelConfigurationStatus;
        readonly publishable: boolean;
        readonly missingFields: readonly string[];
        readonly unknownFields: readonly string[];
        readonly illegalFields: readonly string[];
        readonly conflictFields: readonly string[];
        readonly toolState: import("./publication.js").CapabilityState;
        readonly reasoningState: import("./publication.js").CapabilityState;
        readonly reasoningLevelsKnown: boolean;
        readonly reasoningLevels: readonly string[];
        readonly inheritedFields: readonly string[];
        readonly inheritanceChain: readonly string[];
        /** Recorded value differences that source authority already resolved. */
        readonly discrepancies: readonly FieldResolution[];
        /** Genuine conflicts that no authority can decide; these withhold the model. */
        readonly conflicts: readonly FieldResolution[];
        /** Proven endpoint runtime constraints that narrowed an effective value. */
        readonly deploymentConstraints: readonly {
            readonly field: string;
            readonly value: number;
        }[];
        readonly usingLKG: boolean;
        readonly lkgDetail?: string;
    };
    readonly provenance: {
        readonly protocol: FieldProvenance;
        readonly reasoning: FieldProvenance;
        readonly capabilities: {
            readonly tools: FieldProvenance;
            readonly input: FieldProvenance;
            readonly output: FieldProvenance;
        };
        readonly context: FieldProvenance;
        readonly outputLimit: FieldProvenance;
        readonly pricing: {
            readonly input: FieldProvenance;
            readonly output: FieldProvenance;
            readonly cacheRead: FieldProvenance;
            readonly cacheWrite: FieldProvenance;
        };
        readonly release: FieldProvenance;
    };
}
export interface DiscoveryMappingStats {
    readonly responseEntries: number;
    readonly deployments: number;
    readonly filteredEntries: number;
    readonly models: number;
    readonly modelsDevMatched: number;
    readonly modelsDevUnmatched: number;
    readonly protocolFallbacks: number;
}
export interface DiscoveryDiagnostics {
    readonly schemaVersion: typeof DISCOVERY_DIAGNOSTICS_SCHEMA_VERSION;
    readonly modelInfo: {
        readonly status: "ok" | "invalid";
        readonly primaryPath: "/v1/model/info";
        readonly fallbackPath: "/model/info";
    };
    readonly modelsList: {
        readonly status: "unused";
        readonly path: "/v1/models";
        readonly reason: string;
    };
    readonly modelsDev: {
        readonly status: "ok" | "degraded";
    };
    readonly stats: DiscoveryMappingStats;
    readonly models: readonly ModelDiagnostic[];
    readonly issues: readonly DiagnosticIssue[];
}
export interface DiagnoseModelSpecsResult {
    readonly models: ModelSpec[];
    readonly diagnostics: DiscoveryDiagnostics;
}
export type DiscoveryCacheSource = "network" | "memory-cache" | "stale" | "snapshot" | "none";
export interface DiscoveryCacheDiagnostics {
    readonly source: DiscoveryCacheSource;
    readonly stale: boolean;
    readonly refreshedAt?: number;
    readonly ageMs?: number;
    readonly failureCount: number;
    readonly nextRetryAt?: number;
    readonly pending: boolean;
}
export interface DiscoveryCacheDiagnosticsInput {
    readonly source: DiscoveryCacheSource;
    readonly stale?: boolean;
    readonly refreshedAt?: number;
    readonly failureCount?: number;
    readonly nextRetryAt?: number;
    readonly pending?: boolean;
}
/**
 * Diagnose discovery. `buildModelSpecs` models equal the diagnostics models
 * (single-resolver invariant G22): both project the same resolutions.
 */
export declare function diagnoseModelSpecs(litellmResponse: unknown, modelsDevCatalog: unknown, options: BuildOptions): DiagnoseModelSpecsResult;
export declare function createDiscoveryCacheDiagnostics(input: DiscoveryCacheDiagnosticsInput, now?: number): DiscoveryCacheDiagnostics;
