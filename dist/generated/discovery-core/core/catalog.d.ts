import { type ModelConfigurationStatus, type WithheldReason } from "./publication.js";
export type WithheldRetryability = "retryable" | "not-retryable";
/** One model that cannot be safely published this round, with its reasons. */
export interface WithheldModelEntry {
    readonly id: string;
    readonly status: ModelConfigurationStatus;
    readonly reasons: readonly WithheldReason[];
    /** Stable identity of this model's degradation, over reasons and fields. */
    readonly fingerprint: string;
    /** True when the previous applied catalog published this model. */
    readonly previouslyPublished: boolean;
    readonly retryability: WithheldRetryability;
}
export interface CatalogPublication {
    readonly discovered: number;
    readonly publishable: readonly string[];
    readonly lkgBacked: readonly string[];
    readonly withheld: readonly WithheldModelEntry[];
    /** Discovered models exist and at least one is publishable but not all are. */
    readonly partial: boolean;
    /** Discovered models exist and none can be safely published. */
    readonly unusable: boolean;
    /** Withheld models that were published by the previous applied catalog. */
    readonly regressions: readonly WithheldModelEntry[];
    /** Withheld models that were not published before (first-time withholding). */
    readonly newlyWithheld: readonly WithheldModelEntry[];
    /** Stable identity of the whole withheld problem set. */
    readonly fingerprint: string;
}
/**
 * Stable per-model degradation identity: status, reason codes, and the
 * affected field names. Timestamps, retry counters, failure detail
 * strings, and durations are deliberately excluded so that cosmetic
 * changes never count as a new problem.
 */
export declare function withheldModelFingerprint(status: ModelConfigurationStatus, reasons: readonly WithheldReason[]): string;
/** Stable identity of a whole withheld set, order-independent. */
export declare function catalogDegradationFingerprint(withheld: readonly WithheldModelEntry[]): string;
export interface CatalogPublicationInput {
    readonly publishable: readonly {
        readonly id: string;
        readonly usingLKG: boolean;
    }[];
    readonly withheld: readonly {
        readonly id: string;
        readonly status: ModelConfigurationStatus;
        readonly reasons: readonly WithheldReason[];
        readonly retryable: boolean;
    }[];
    readonly discovered: number;
    /** Model ids the previously applied catalog published. */
    readonly previouslyPublished?: ReadonlySet<string>;
}
export declare function buildCatalogPublication(input: CatalogPublicationInput): CatalogPublication;
/**
 * What the user has already been told about. Persisted across host
 * restarts so the same problem set is not reported twice. This state is
 * never consulted when deciding whether a model is publishable.
 */
export interface DegradationAcknowledgement {
    readonly version: 1;
    /** Whole-set fingerprint at the moment the user reviewed the state. */
    readonly fingerprint: string;
    /** Model id (case-insensitive) → per-model degradation fingerprint. */
    readonly models: Readonly<Record<string, string>>;
    readonly acknowledgedAt: string;
}
export type AcknowledgementReason = "catalog-recovered" | "unchanged" | "improved" | "regression" | "new-issues" | "catalog-unusable" | "first-observation";
export interface AcknowledgementDecision {
    /** Whether the host should surface this round to the user. */
    readonly notify: boolean;
    readonly reason: AcknowledgementReason;
    /** Updated suppression state; `undefined` clears it (nothing to suppress). */
    readonly next: DegradationAcknowledgement | undefined;
}
/**
 * Decide whether this round may be surfaced, and what the next suppression
 * state should be.
 *
 * - full recovery clears the acknowledgement;
 * - a strict subset (a withheld model recovered, the rest unchanged) is an
 *   improvement and stays quiet while updating the baseline;
 * - a previously published model becoming withheld is a regression and is
 *   always surfaced, even when the user acknowledged other problems;
 * - a newly discovered model that cannot be published is visible in
 *   diagnostics but is not interruptive on its own;
 * - `discovered > 0 && publishable = 0` is always surfaced: the endpoint is
 *   reachable but the catalog is currently unusable.
 */
export declare function decideAcknowledgement(previous: DegradationAcknowledgement | undefined, catalog: CatalogPublication, acknowledgedAt: string): AcknowledgementDecision;
export declare function isDegradationAcknowledgement(value: unknown): value is DegradationAcknowledgement;
/**
 * Build catalog facts from a Core publication partition. Adapters pass the
 * model ids their previously *applied* catalog published so a withdrawn
 * model can be reported as a regression instead of a first-time gap.
 */
export declare function catalogFromPublication(result: {
    readonly publishable: readonly {
        readonly spec: {
            readonly id: string;
        };
        readonly assessment: {
            readonly usingLKG: boolean;
        };
    }[];
    readonly blocked: readonly {
        readonly spec: {
            readonly id: string;
        };
        readonly assessment: import("./publication.js").CompletenessAssessment;
    }[];
}, options?: {
    readonly previouslyPublished?: ReadonlySet<string>;
    readonly discovered?: number;
}): CatalogPublication;
