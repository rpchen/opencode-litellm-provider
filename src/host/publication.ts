/**
 * Adapter-side publication state for OpenCode.
 *
 * No business policy lives here: the Core partition decides what may
 * publish. This module only anchors per-endpoint controller memory
 * (LKG store + degraded acceptance) to the ProviderSnapshot object the
 * discovery loop already mutates, so RPC handlers and the loop share
 * state without touching persisted shapes.
 */
import {
  createLastKnownGoodStore,
  degradationEligibility,
  type BlockedEntry,
  type CompletenessAssessment,
  type LastKnownGoodStore,
  type PublishableEntry,
} from "../generated/discovery-core/index.js"

export interface PublicationModelState {
  readonly id: string
  readonly status: string
}

export interface PublicationBlockedModel {
  readonly id: string
  readonly status: string
  readonly gaps: readonly string[]
  /** Core eligibility. Adapters must not re-derive this from status strings. */
  readonly degradationEligible: boolean
  readonly degradationReason?: string
}

/** Adapter-visible slice of the Core publication partition. */
export interface PublicationSummary {
  readonly publishable: readonly PublicationModelState[]
  readonly degradedIDs: readonly string[]
  readonly lkgIDs: readonly string[]
  readonly blocked: readonly PublicationBlockedModel[]
  readonly failureKind?: string
}

/** Per-endpoint controller memory anchored to one ProviderSnapshot. */
export interface PublicationState {
  readonly store: LastKnownGoodStore
  readonly acceptedDegradedIDs: Set<string>
}

export function createPublicationState(): PublicationState {
  return { store: createLastKnownGoodStore(), acceptedDegradedIDs: new Set<string>() }
}

export function summarizePublication(
  publication: { publishable: readonly PublishableEntry[]; blocked: readonly BlockedEntry[] },
  failureKind?: string,
): PublicationSummary {
  return {
    publishable: publication.publishable.map((entry) => ({
      id: entry.spec.id,
      status: entry.assessment.status,
    })),
    degradedIDs: publication.publishable
      .filter((entry) => entry.degraded !== undefined)
      .map((entry) => entry.spec.id),
    lkgIDs: publication.publishable
      .filter((entry) => entry.assessment.usingLKG)
      .map((entry) => entry.spec.id),
    blocked: publication.blocked.map((entry) => {
      const eligibility = degradationEligibility(entry.assessment)
      return {
        id: entry.spec.id,
        status: entry.assessment.status,
        degradationEligible: eligibility.eligible,
        degradationReason: eligibility.eligible ? undefined : eligibility.reason,
        gaps: [
          ...entry.assessment.missingFields,
          ...entry.assessment.unknownFields,
          ...entry.assessment.illegalFields,
        ],
      }
    }),
    failureKind,
  }
}

export interface AcceptDegradedOutcome {
  readonly accepted: boolean
  readonly status?: string
  readonly gaps?: readonly string[]
  readonly reason?: string
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
export function acceptDegradedForSummary(
  summary: PublicationSummary | undefined,
  accepted: Set<string>,
  modelId: string,
): AcceptDegradedOutcome {
  const blocked = summary?.blocked.find((model) => model.id === modelId)
  if (!blocked) {
    const publishable = summary?.publishable.some((model) => model.id === modelId) ?? false
    return publishable
      ? { accepted: false, reason: "already-configured" }
      : { accepted: false, reason: "unknown-model" }
  }
  if (!blocked.degradationEligible) {
    return {
      accepted: false,
      status: blocked.status,
      gaps: blocked.gaps,
      reason: blocked.degradationReason ?? "not-eligible",
    }
  }
  accepted.add(modelId)
  return { accepted: true, status: blocked.status, gaps: blocked.gaps }
}

/** Test/helper seam: eligibility always comes from Core, never from a local status table. */
export function degradationReasonFor(assessment: CompletenessAssessment): string | undefined {
  const eligibility = degradationEligibility(assessment)
  return eligibility.eligible ? undefined : eligibility.reason
}

export interface SnapshotPublicationLike {
  diagnostics?: { publication?: PublicationSummary }
  publicationState?: PublicationState
}

/**
 * Snapshot-anchored acceptance: ensures the per-endpoint controller
 * exists on the snapshot the discovery loop mutates, so RPC/command
 * handlers and the next refresh share the accepted set.
 */
export function acceptDegradedForSnapshot(
  snapshot: SnapshotPublicationLike,
  modelId: string,
): AcceptDegradedOutcome {
  const state = snapshot.publicationState ??= createPublicationState()
  return acceptDegradedForSummary(snapshot.diagnostics?.publication, state.acceptedDegradedIDs, modelId)
}

/** Split `<endpoint-id> <model-id>` (multi) or `<model-id>` (legacy) input text. */
export function splitAcceptArgs(text: string): string[] {
  return text.trim().split(/\s+/).filter((part) => part.length > 0)
}
