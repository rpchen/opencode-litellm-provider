/**
 * Adapter-side publication state for OpenCode.
 *
 * No business policy lives here: the Core partition decides what may
 * publish. This module only anchors per-endpoint controller memory
 * (LKG store + degraded acceptance) to the ProviderSnapshot object the
 * discovery loop already mutates, so RPC handlers and the loop share
 * state without touching persisted shapes.
 */
import { type BlockedEntry, type CompletenessAssessment, type LastKnownGoodStore, type PublishableEntry } from "../generated/discovery-core/index.js";
export interface PublicationModelState {
    readonly id: string;
    readonly status: string;
}
export interface PublicationBlockedModel {
    readonly id: string;
    readonly status: string;
    readonly gaps: readonly string[];
    /** Core eligibility. Adapters must not re-derive this from status strings. */
    readonly degradationEligible: boolean;
    readonly degradationReason?: string;
}
/** Adapter-visible slice of the Core publication partition. */
export interface PublicationSummary {
    readonly publishable: readonly PublicationModelState[];
    readonly degradedIDs: readonly string[];
    readonly lkgIDs: readonly string[];
    readonly blocked: readonly PublicationBlockedModel[];
    readonly failureKind?: string;
}
/** Per-endpoint controller memory anchored to one ProviderSnapshot. */
export interface PublicationState {
    readonly store: LastKnownGoodStore;
    readonly acceptedDegradedIDs: Set<string>;
}
export declare function createPublicationState(): PublicationState;
export declare function summarizePublication(publication: {
    publishable: readonly PublishableEntry[];
    blocked: readonly BlockedEntry[];
}, failureKind?: string): PublicationSummary;
export interface AcceptDegradedOutcome {
    readonly accepted: boolean;
    readonly status?: string;
    readonly gaps?: readonly string[];
    readonly reason?: string;
}
/**
 * Record explicit user acceptance for a blocked model.
 *
 * Succeeds only for models the Core partition currently reports as
 * blocked; already-publishable models need no acceptance and unknown
 * ids are rejected. The degraded label is preserved by the Core
 * wrapper on the next refresh; this helper never re-labels anything
 * as configured.
 */
export declare function acceptDegradedForSummary(summary: PublicationSummary | undefined, accepted: Set<string>, modelId: string): AcceptDegradedOutcome;
/** Test/helper seam: eligibility always comes from Core, never from a local status table. */
export declare function degradationReasonFor(assessment: CompletenessAssessment): string | undefined;
export interface SnapshotPublicationLike {
    diagnostics?: {
        publication?: PublicationSummary;
    };
    publicationState?: PublicationState;
}
/**
 * Snapshot-anchored acceptance: ensures the per-endpoint controller
 * exists on the snapshot the discovery loop mutates, so RPC/command
 * handlers and the next refresh share the accepted set.
 */
export declare function acceptDegradedForSnapshot(snapshot: SnapshotPublicationLike, modelId: string): AcceptDegradedOutcome;
/** Split `<endpoint-id> <model-id>` (multi) or `<model-id>` (legacy) input text. */
export declare function splitAcceptArgs(text: string): string[];
