/**
 * Adapter-side publication state for OpenCode.
 *
 * No business policy lives here: the Core partition decides what may
 * publish. This module only anchors per-endpoint controller memory
 * (LKG store, regression baseline, notification acknowledgement) to the
 * ProviderSnapshot object the discovery loop already mutates, so RPC
 * handlers and the loop share state without touching persisted shapes.
 *
 * Acknowledgement is reporting state only. There is no user confirmation
 * path into publication: a model Core withholds stays withheld.
 */
import { type BlockedEntry, type CatalogPublication, type DegradationAcknowledgement, type LastKnownGoodStore, type PublicationResult, type PublishableEntry } from "../generated/discovery-core/index.js";
export interface PublicationModelState {
    readonly id: string;
    readonly status: string;
}
export interface PublicationWithheldReason {
    readonly code: string;
    readonly message: string;
    readonly fields: readonly string[];
}
/** One model that could not be safely published, with every reason. */
export interface PublicationWithheldModel {
    readonly id: string;
    readonly status: string;
    readonly reasons: readonly PublicationWithheldReason[];
    readonly previouslyPublished: boolean;
    readonly retryable: boolean;
}
/** A field-level evidence fact worth showing to the user. */
export interface PublicationFieldFact {
    readonly model: string;
    readonly field: string;
    readonly status: string;
    readonly resolution: string;
}
/** Adapter-visible slice of the Core publication + catalog partition. */
export interface PublicationSummary {
    readonly discovered: number;
    readonly publishable: readonly PublicationModelState[];
    readonly lkgIDs: readonly string[];
    readonly lkgDetail?: string;
    readonly withheld: readonly PublicationWithheldModel[];
    readonly partial: boolean;
    readonly unusable: boolean;
    readonly regressions: readonly string[];
    readonly discrepancies: readonly PublicationFieldFact[];
    readonly conflicts: readonly PublicationFieldFact[];
    readonly failureKind?: string;
    readonly acknowledgement: {
        readonly notify: boolean;
        readonly reason: string;
        readonly fingerprint: string;
    };
}
/** Per-endpoint controller memory anchored to one ProviderSnapshot. */
export interface PublicationState {
    readonly store: LastKnownGoodStore;
    previouslyPublished: Set<string>;
    acknowledgement?: DegradationAcknowledgement;
    /** Unconsumed user-facing notice derived from the acknowledgement decision. */
    pendingNotice?: {
        readonly reason: string;
        readonly message: string;
    };
}
export declare function createPublicationState(): PublicationState;
export declare function summarizePublication(publication: PublicationResult, catalogFacts: CatalogPublication, failureKind?: string): PublicationSummary;
/** Core catalog facts for one publication partition (single source of truth). */
export declare function catalogFactsFor(publication: PublicationResult, options?: {
    readonly previouslyPublished?: ReadonlySet<string>;
    readonly discovered?: number;
}): CatalogPublication;
/**
 * User-facing notice for a materially new or regressed availability
 * problem. A first-time gap on a newly discovered model is intentionally
 * silent (diagnostics only); a regression or an unusable catalog is not.
 */
export declare function catalogNotice(summary: PublicationSummary | undefined): {
    readonly level: "info" | "warning";
    readonly message: string;
} | undefined;
export interface SnapshotPublicationLike {
    diagnostics?: {
        publication?: PublicationSummary;
    };
    publicationState?: PublicationState;
}
/** Consume a pending catalog notice exactly once. */
export declare function takePendingNotice(snapshot: SnapshotPublicationLike): {
    readonly reason: string;
    readonly message: string;
} | undefined;
/** Test/helper seam kept for the publication partition types. */
export type { BlockedEntry, PublishableEntry };
