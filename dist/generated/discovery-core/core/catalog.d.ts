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
 * Bumped when the persisted publication memory changes shape or meaning.
 * An unreadable or older record is dropped, which can only cause one
 * repeated notification — never a publication change.
 */
export declare const PUBLICATION_MEMORY_SCHEMA_VERSION: 1;
/** Versioned shape of the acknowledgement record itself. */
export declare const ACKNOWLEDGEMENT_SCHEMA_VERSION: 1;
/**
 * What the user has already been told about. Persisted across host
 * restarts so the same problem set is not reported twice. This state is
 * never consulted when deciding whether a model is publishable.
 */
export interface DegradationAcknowledgement {
    readonly schemaVersion: typeof ACKNOWLEDGEMENT_SCHEMA_VERSION;
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
 * Everything an adapter must persist per endpoint to keep notification
 * decisions stable across host restarts:
 *
 * - `acknowledgement` — the problem sets the user has already seen;
 * - `published` — the regression baseline ("this model was published by the
 *   applied catalog"), so a withdrawal is still a regression after a restart.
 *
 * Both fields are reporting state. Neither participates in publication.
 */
export interface PublicationMemory {
    readonly schemaVersion: typeof PUBLICATION_MEMORY_SCHEMA_VERSION;
    readonly acknowledgement?: DegradationAcknowledgement;
    readonly published: readonly string[];
}
/**
 * Read persisted publication memory. A missing, corrupt, foreign, or
 * older-schema record yields `undefined`, which at worst repeats a
 * notification on the next round; it can never publish or withhold a model.
 */
export declare function parsePublicationMemory(value: unknown): PublicationMemory | undefined;
/** Stable, versioned payload an adapter stores verbatim. */
export declare function serializePublicationMemory(memory: PublicationMemory): unknown;
/**
 * Next regression baseline: keep previously published models that the
 * endpoint still serves (published or withheld), add the ones published now,
 * and forget models LiteLLM no longer returns at all so the set stays bounded.
 */
export declare function nextPublishedBaseline(previous: readonly string[], currentPublishable: readonly string[], currentWithheld: readonly string[]): string[];
/**
 * Decide whether this round may be surfaced, and what the next suppression
 * state should be. The returned state is what an adapter persists, so a
 * restart re-observes the same problem set as `unchanged`.
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
/**
 * Decide whether this round may be surfaced, and what the next suppression
 * state should be. The returned state is what an adapter persists, so after a
 * restart the same problem set is recognised as .
 *
 * - a previously published model becoming withheld is a regression and is
 *   always surfaced, even when the user acknowledged other problems;
 * - an unusable catalog (discovered > 0, nothing publishable) is surfaced the
 *   first time it is observed and whenever it materially grows; a continuing
 *   identical state stays quiet and remains visible in diagnostics;
 * - full recovery clears the acknowledgement;
 * - a strict subset (a withheld model recovered, the rest unchanged) is an
 *   improvement and stays quiet while updating the baseline;
 * - a newly discovered model that cannot be published is visible in
 *   diagnostics but is not interruptive on its own.
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
