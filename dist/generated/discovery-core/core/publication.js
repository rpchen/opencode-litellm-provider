/**
 * Trusted model-capability publication loop.
 *
 * Single business source of truth for answering: "is this discovered
 * model's metadata reliable enough to publish as a fully configured
 * model?" Covers completeness/publishability policy, false-vs-unknown
 * semantics, reasoning/levels decoupling, deterministic inheritance,
 * failure taxonomy, TTL-free Last Known Good, evidence source
 * authority, resolved discrepancies vs unresolved conflicts, and
 * field-level provenance.
 *
 * The publication gate is never relaxed. There is no user confirmation,
 * override, or degraded-publication path: a model that cannot be proven
 * trustworthy is withheld, while every other model of the same endpoint
 * is published normally.
 *
 * No I/O, no timers, no host SDK imports. Adapters consume the verdicts
 * without reimplementing policy.
 */
import { mapCapabilities, } from "./capabilities.js";
import { RUNTIME_CONSTRAINT_KEYS, deploymentConstraintValue, modalityDimensions, modelsDevNumeric, resolveBooleanField, resolveModalityField, resolveNumericField, } from "./evidence.js";
import { candidateModelIDs, aggregateTriState, resolveInheritedRecord, resolveReasoningLevels, resolveReasoningState, modelsDevReasoning, canonicalModelID, selectModelsDevRecordDetailed, groupIdentityEvidence, } from "./modelsdev.js";
import { isRecord, optionalBoolean, optionalNumber, groupLiteLLMDeployments, } from "./litellm.js";
import { resolveProtocol } from "./protocol.js";
import { buildModelSpecs } from "./build.js";
/**
 * Withheld reasons for one assessment. Publication state never depends on
 * user acknowledgement; this list exists so the user can see *why* a
 * model is not available and whether a retry can help.
 */
export function withheldReasons(assessment) {
    if (assessment.publishable)
        return [];
    const reasons = [];
    const gaps = [...assessment.missingFields, ...assessment.unknownFields, ...assessment.illegalFields];
    const conflictFields = [
        ...assessment.conflictFields,
        ...assessment.conflicts.map((conflict) => conflict.field),
    ];
    if (assessment.status === "ambiguous" || assessment.identity.outcome === "ambiguous") {
        reasons.push({
            code: "identity-ambiguous",
            message: "canonical model identity could not be resolved to exactly one trusted record",
            fields: ["identity"],
        });
    }
    if (assessment.status === "unmatched") {
        reasons.push({
            code: "identity-unmatched",
            message: "no models.dev record matched this LiteLLM model identity",
            fields: ["identity"],
        });
    }
    if (assessment.status === "metadata-unavailable") {
        reasons.push({
            code: "metadata-unavailable",
            message: `metadata source is temporarily unavailable (${assessment.failure?.kind ?? "unavailable"}) and no valid trusted snapshot exists`,
            fields: ["metadata"],
        });
    }
    if (assessment.status === "discovered-incomplete" || assessment.status === "unmatched") {
        reasons.push({
            code: "incomplete-metadata",
            message: "metadata is not complete enough to prove a correct model configuration",
            fields: gaps,
        });
    }
    if (conflictFields.length > 0) {
        reasons.push({
            code: "authoritative-conflict",
            message: "evidence conflicts and no authority can decide, so no safe configuration can be published",
            fields: [...new Set(conflictFields)],
        });
    }
    if (assessment.illegalFields.length > 0) {
        reasons.push({
            code: "illegal-metadata",
            message: "declared metadata contains illegal values",
            fields: [...assessment.illegalFields],
        });
    }
    return reasons;
}
/** Pure classification of a metadata fetch/merge failure. Never emits defaults. */
export function classifyMetadataFailure(error) {
    const code = ((isRecord(error) && typeof error.code === "string" ? error.code : undefined) ??
        (error instanceof Error ? error.name : undefined) ??
        "").toUpperCase();
    const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
    const status = isRecord(error) &&
        (typeof error.status === "number" || typeof error.statusCode === "number")
        ? Number(isRecord(error) ? (error.status ?? error.statusCode) : NaN)
        : (error instanceof Response ? error.status : undefined);
    const httpStatus = typeof status === "number" && Number.isFinite(status) ? status : undefined;
    if (/^(ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|FETCH_FAILED|NETWORK)/.test(code) ||
        /fetch failed|network|econnrefused|enotfound|socket hang up/.test(message)) {
        if (/timeout|timed out|etimeout|etimedout|abort/.test(code + " " + message)) {
            return { kind: "timeout", retryable: true, detail: message || undefined, httpStatus };
        }
        return { kind: "unreachable", retryable: true, detail: message || undefined, httpStatus };
    }
    if (/TIMEOUT|ETIMEDOUT|ETIMEOUT|ABORT/.test(code) || /timeout|timed out|aborted/.test(message)) {
        return { kind: "timeout", retryable: true, detail: message || undefined, httpStatus };
    }
    if (httpStatus !== undefined) {
        if (httpStatus === 408 || httpStatus === 429) {
            return { kind: "timeout", retryable: true, detail: `HTTP ${httpStatus}`, httpStatus };
        }
        if (httpStatus >= 500) {
            return { kind: "server-5xx", retryable: true, detail: `HTTP ${httpStatus}`, httpStatus };
        }
        if (httpStatus === 404) {
            return { kind: "not-found", retryable: false, detail: `HTTP 404`, httpStatus };
        }
        if (httpStatus === 422) {
            return { kind: "schema-incompatible", retryable: false, detail: `HTTP 422`, httpStatus };
        }
    }
    if (/AMBIGU/.test(code) || /ambiguous|multiple.*candidate/.test(message)) {
        return { kind: "ambiguous", retryable: false, detail: message || undefined, httpStatus };
    }
    if (/SCHEMA|VALIDAT|INCOMPATIBLE|ZOD/.test(code) || /schema|incompatible|cannot read|unexpected token/.test(message)) {
        return { kind: "schema-incompatible", retryable: false, detail: message || undefined, httpStatus };
    }
    if (/ILLEGAL|INVALID.*(value|limit|metadata)/.test(code) || /illegal|invalid (metadata|limit|value)/.test(message)) {
        return { kind: "illegal-value", retryable: false, detail: message || undefined, httpStatus };
    }
    if (/NOT.*FOUND|ENOENT/.test(code) || /not found|no such model/.test(message)) {
        return { kind: "not-found", retryable: false, detail: message || undefined, httpStatus };
    }
    return { kind: "missing-field", retryable: false, detail: message || undefined, httpStatus };
}
export function metadataFailureFor(kind, detail) {
    return {
        kind,
        retryable: kind === "timeout" || kind === "server-5xx" || kind === "unreachable",
        detail,
    };
}
function toolProvenance(group, selected, inherited) {
    if (group.deployments.some((d) => optionalBoolean(d.modelInfo.supports_function_calling) !== undefined)) {
        return { source: "litellm", detail: "supports_function_calling" };
    }
    if (optionalBoolean(selected?.record.tool_call) !== undefined) {
        const detail = `tool_call -> provider ${selected?.providerID} -> model ${selected?.modelID}`;
        return inherited
            ? { source: "canonical-inheritance", detail }
            : { source: "models.dev", detail };
    }
    return { source: "none", detail: "no trusted tool-call evidence" };
}
function firstTierPoint(deployment) {
    const points = [];
    for (const [key, rawValue] of Object.entries(deployment.modelInfo)) {
        const match = /^input_cost_per_token_above_(\d+)k_tokens$/.exec(key);
        const value = optionalNumber(rawValue);
        if (match?.[1] && value !== undefined && value !== 0)
            points.push(Number(match[1]) * 1000);
    }
    const tiers = deployment.modelInfo.tiered_pricing;
    if (Array.isArray(tiers)) {
        for (const tier of tiers) {
            if (!isRecord(tier) || !Array.isArray(tier.range))
                continue;
            const start = optionalNumber(tier.range[0]);
            if (start !== undefined && start > 0)
                points.push(Math.floor(start));
        }
    }
    return points.length > 0 ? Math.min(...points) : undefined;
}
/** Narrowest pricing-tier bound, used only when `contextTierCap` is enabled. */
function contextTierBounds(group, contextTierCap) {
    if (!contextTierCap)
        return [];
    const tierPoints = group.deployments
        .map(firstTierPoint)
        .filter((value) => value !== undefined);
    return tierPoints.length > 0 ? [Math.min(...tierPoints)] : [];
}
function limitProvenance(field, resolution, selected, bounds) {
    if (resolution.value === undefined) {
        if (resolution.status === "missing")
            return { source: "none", detail: resolution.resolution };
        if (resolution.status === "illegal")
            return { source: "litellm", detail: resdetail(resolution) };
        return { source: resolution.status === "unresolved-conflict" ? "derived" : "litellm", detail: resolution.resolution };
    }
    if (field === "context" && bounds.length > 0 && resolution.value === bounds[0]) {
        return { source: "derived", detail: `LiteLLM pricing tier cap at ${bounds[0]} tokens` };
    }
    if (resolution.selectedSource === "models.dev") {
        return {
            source: "models.dev",
            detail: `limit.${field} -> provider ${selected?.providerID ?? "unknown-provider"} -> model ${selected?.modelID ?? "unknown-model"}`,
        };
    }
    return {
        source: "litellm",
        detail: `limit.${field} group evidence: ${resolution.resolution}`,
    };
}
function resdetail(resolution) {
    return resolution.resolution;
}
/**
 * Resolve one gated limit dimension.
 *
 * Legality is checked first and independently of authority: an explicitly
 * declared non-positive value (descriptive or constraint, deployment-level
 * or trusted model-level) is illegal metadata, never a missing value or a
 * default. After that, authoritative intrinsic metadata decides and proven
 * endpoint runtime constraints narrow the effective value.
 */
function assessLimit(group, selected, field, options) {
    const bounds = field === "context" ? contextTierBounds(group, options.contextTierCap) : [];
    const rawIntrinsic = selected ? modelsDevNumeric(selected, field) : undefined;
    const illegalIntrinsic = rawIntrinsic !== undefined && !(rawIntrinsic > 0);
    const intrinsic = rawIntrinsic !== undefined && rawIntrinsic > 0 ? rawIntrinsic : undefined;
    const resolved = resolveNumericField({
        field,
        group,
        intrinsic,
        intrinsicDetail: `limit.${field} -> provider ${selected?.providerID ?? "unknown-provider"} -> model ${selected?.modelID ?? "unknown-model"}`,
        bounds,
    });
    const resolution = illegalIntrinsic
        ? {
            ...resolved.resolution,
            status: "illegal",
            value: undefined,
            resolution: `trusted model-level ${field} limit is non-positive; illegal, not missing`,
        }
        : resolved.resolution;
    const provenance = limitProvenance(field, resolution, selected, bounds);
    if (illegalIntrinsic) {
        return {
            value: 0, valid: false, missing: false, unknown: false, conflict: false, illegal: true,
            provenance: { source: "models.dev", detail: `illegal model-level ${field} limit metadata` },
            resolution,
            discrepancy: false,
        };
    }
    if (resolved.value !== undefined) {
        return {
            value: Math.floor(resolved.value),
            valid: true,
            missing: false,
            unknown: false,
            conflict: false,
            illegal: false,
            provenance,
            resolution,
            discrepancy: resolved.discrepancy,
            deploymentConstraint: deploymentConstraintValue(group, RUNTIME_CONSTRAINT_KEYS[field]),
        };
    }
    return {
        value: 0,
        valid: false,
        missing: resolved.missing,
        unknown: resolved.unknown,
        conflict: resolved.conflict,
        illegal: resolved.illegal,
        provenance,
        resolution,
        discrepancy: false,
    };
}
/**
 * models.dev complete modality set: listed means supported, unlisted means
 * not in the declared set. Only consumed when the canonical identity is
 * reliably resolved, which is exactly when `selected` is defined.
 */
function modelsDevModalityList(selected, direction) {
    const modalities = selected?.record.modalities;
    if (!isRecord(modalities) || !Array.isArray(modalities[direction]))
        return undefined;
    const list = modalities[direction].filter((value) => typeof value === "string");
    return list.length > 0 ? list : undefined;
}
/**
 * Resolve one modality direction. Authoritative intrinsic modalities decide
 * the direction; contradicting LiteLLM flags are a retained discrepancy; a
 * proven endpoint constraint (`litellm_params` flag explicitly `false`)
 * narrows the effective set. Without authority the sparse-flag rules apply:
 * an incompletely declared direction stays unknown.
 */
function assessModalities(values, group, selected, direction) {
    const intrinsic = modelsDevModalityList(selected, direction);
    const resolved = resolveModalityField({
        direction,
        group,
        intrinsic,
        intrinsicDetail: `modalities.${direction} -> provider ${selected?.providerID ?? "unknown-provider"} -> model ${selected?.modelID ?? "unknown-model"}`,
    });
    if (!resolved.known) {
        return {
            values,
            known: false,
            provenance: resolved.conflict
                ? { source: "derived", detail: `${direction} modality evidence conflicts; not coerced to a set` }
                : { source: "default", detail: `${direction} modality evidence incomplete; text baseline without full evidence` },
            resolution: resolved.resolution,
            discrepancy: false,
        };
    }
    return {
        values: [...resolved.values],
        known: true,
        provenance: intrinsic !== undefined
            ? {
                source: "models.dev",
                detail: `modalities.${direction} -> provider ${selected?.providerID ?? "unknown-provider"} -> model ${selected?.modelID ?? "unknown-model"}`,
            }
            : { source: "litellm", detail: `${direction} modality evidence covers every dimension` },
        resolution: resolved.resolution,
        discrepancy: resolved.discrepancy,
    };
}
function catalogHasProviders(catalog) {
    if (!isRecord(catalog))
        return false;
    return Object.values(catalog).some((provider) => isRecord(provider) && isRecord(provider.models) && Object.keys(provider.models).length > 0);
}
/**
 * Assess one deployment group for normal publication.
 *
 * Pure function of already-fetched inputs: it never fills defaults to
 * hide gaps and never guesses from names or families.
 */
export function assessModelConfiguration(group, catalog, options, input = { catalogAvailable: catalogHasProviders(catalog) }) {
    const detailed = selectModelsDevRecordDetailed(group, catalog);
    const inherited = resolveInheritedRecord(detailed.selected, catalog);
    const effectiveSelected = inherited
        ? { ...detailed.selected, record: inherited.record }
        : detailed.selected;
    const protocol = resolveProtocol(group, options.protocolOverrides);
    const mapped = mapCapabilities(group, effectiveSelected, options.contextTierCap);
    const toolIntrinsic = optionalBoolean(effectiveSelected?.record.tool_call);
    const toolAggregation = aggregateTriState(group.deployments.map((d) => optionalBoolean(d.modelInfo.supports_function_calling)), toolIntrinsic);
    const toolResolved = resolveBooleanField({
        field: "capabilities.tools",
        descriptiveKey: "supports_function_calling",
        group,
        intrinsic: toolIntrinsic,
        intrinsicDetail: `tool_call -> provider ${effectiveSelected?.providerID ?? "unknown-provider"} -> model ${effectiveSelected?.modelID ?? "unknown-model"}`,
        fallbackState: toolAggregation.state,
        fallbackConflict: toolAggregation.conflict,
    });
    const toolState = toolResolved.state;
    const reasoningState = resolveReasoningState(group, effectiveSelected);
    const reasoningResolved = resolveBooleanField({
        field: "reasoning",
        descriptiveKey: "supports_reasoning",
        group,
        intrinsic: modelsDevReasoning(effectiveSelected),
        intrinsicDetail: `reasoning -> provider ${effectiveSelected?.providerID ?? "unknown-provider"} -> model ${effectiveSelected?.modelID ?? "unknown-model"}`,
        fallbackState: reasoningState.state,
        fallbackConflict: reasoningState.conflict,
    });
    const reasoningVerdict = { state: reasoningResolved.state, conflict: reasoningResolved.conflict };
    const levels = resolveReasoningLevels(effectiveSelected, protocol);
    const context = assessLimit(group, effectiveSelected, "context", options);
    const output = assessLimit(group, effectiveSelected, "output", options);
    const inputModalities = assessModalities(mapped.capabilities.input, group, effectiveSelected, "input");
    const outputModalities = assessModalities(mapped.capabilities.output, group, effectiveSelected, "output");
    const missingFields = [];
    const unknownFields = [];
    const illegalFields = [];
    const conflictFields = [];
    if (context.missing)
        missingFields.push("limit.context");
    if (output.missing)
        missingFields.push("limit.output");
    if (context.illegal)
        illegalFields.push("limit.context");
    if (output.illegal)
        illegalFields.push("limit.output");
    if (context.conflict)
        conflictFields.push("limit.context");
    if (output.conflict)
        conflictFields.push("limit.output");
    if (toolState === "unknown")
        unknownFields.push("capabilities.tools");
    if (reasoningVerdict.state === "unknown")
        unknownFields.push("reasoning");
    if (!inputModalities.known)
        unknownFields.push("capabilities.input");
    if (!outputModalities.known)
        unknownFields.push("capabilities.output");
    if (context.unknown)
        unknownFields.push("limit.context");
    if (output.unknown)
        unknownFields.push("limit.output");
    // Both buckets are first-class facts: a *resolved discrepancy* keeps the
    // model publishable, an *unresolved conflict* withholds it with a reason.
    const fieldResolutions = [
        context.resolution,
        output.resolution,
        inputModalities.resolution,
        outputModalities.resolution,
        toolResolved.resolution,
        reasoningResolved.resolution,
    ];
    const discrepancies = fieldResolutions.filter((resolution) => resolution.status === "resolved-discrepancy");
    const conflicts = fieldResolutions.filter((resolution) => resolution.status === "unresolved-conflict");
    const catalogDown = !input.catalogAvailable;
    const litellmOnlyComplete = detailed.outcome === "unmatched" &&
        missingFields.length === 0 &&
        unknownFields.length === 0 &&
        illegalFields.length === 0 &&
        conflictFields.length === 0;
    const groupConflicts = conflictFields.length > 0;
    let status;
    if (detailed.outcome === "ambiguous")
        status = "ambiguous";
    else if (groupConflicts || illegalFields.length > 0)
        status = "invalid-metadata";
    else if (litellmOnlyComplete)
        status = "configured";
    else if (detailed.outcome === "unmatched" && catalogDown)
        status = "metadata-unavailable";
    else if (detailed.outcome === "unmatched" && missingFields.length === 0 && unknownFields.length === 0)
        status = "unmatched";
    else if (catalogDown && (missingFields.length > 0 || unknownFields.length > 0 || detailed.outcome === "unmatched")) {
        status = "metadata-unavailable";
    }
    else if (missingFields.length > 0 || unknownFields.length > 0)
        status = "discovered-incomplete";
    else if (detailed.outcome === "unmatched")
        status = "unmatched";
    else
        status = "configured";
    const publishable = status === "configured";
    return {
        publishable,
        status,
        tools: {
            state: toolState,
            provenance: toolResolved.resolution.selectedSource === "models.dev"
                ? { source: "models.dev", detail: `tool_call -> provider ${effectiveSelected?.providerID} -> model ${effectiveSelected?.modelID}` }
                : toolAggregation.conflict
                    ? { source: "derived", detail: "deployment tool declarations conflict; unknown is not coerced" }
                    : toolProvenance(group, effectiveSelected, inherited?.inheritedFields.includes("tool_call") ?? false),
            resolution: toolResolved.resolution,
            discrepancy: toolResolved.discrepancy,
        },
        reasoning: {
            state: reasoningVerdict.state,
            levelsKnown: levels.known,
            levels: levels.values,
            provenance: reasoningResolved.resolution.selectedSource === "models.dev"
                ? { source: "models.dev", detail: `reasoning -> provider ${effectiveSelected?.providerID} -> model ${effectiveSelected?.modelID}` }
                : reasoningState.source === "litellm"
                    ? { source: "litellm", detail: "supports_reasoning" }
                    : reasoningState.source === "derived"
                        ? { source: "derived", detail: "LiteLLM and models.dev reasoning evidence" }
                        : { source: "none", detail: "no reasoning support metadata" },
            levelsProvenance: levels.known
                ? { source: "models.dev", detail: "reasoning_options" }
                : { source: "none", detail: "no reasoning level metadata" },
            conflict: reasoningVerdict.conflict,
            resolution: reasoningResolved.resolution,
            discrepancy: reasoningResolved.discrepancy,
        },
        context: inherited && inherited.inheritedFields.includes("limit") && context.valid
            ? { ...context, provenance: { source: "canonical-inheritance", detail: inherited.chain.join("; ") } }
            : context,
        output: inherited && inherited.inheritedFields.includes("limit") && output.valid
            ? { ...output, provenance: { source: "canonical-inheritance", detail: inherited.chain.join("; ") } }
            : output,
        inputModalities,
        outputModalities,
        identity: detailed,
        inheritedFields: inherited?.inheritedFields ?? [],
        inheritanceChain: inherited?.chain ?? [],
        missingFields,
        unknownFields,
        illegalFields,
        conflictFields,
        discrepancies,
        conflicts,
        failure: input.failure,
        usingLKG: false,
    };
}
/** True only for `configured` and `configured-lkg`. This is the whole gate. */
export function isNormallyPublishable(status) {
    return status === "configured" || status === "configured-lkg";
}
// ---------------------------------------------------------------------------
// Last Known Good (no fixed TTL)
// ---------------------------------------------------------------------------
/**
 * Bumped when publication completeness grows, captured facts change
 * meaning, the authority model changes, or the LKG identity shape changes.
 * An older number cannot satisfy a newer policy; restoration also
 * re-checks the captured verdict against the stored spec and the stored
 * stable identity against the current group evidence, so a same-number
 * entry with unknown capabilities, inconsistent facts, or a route-stripped
 * identity still fails closed.
 */
export const PUBLICATION_SCHEMA_VERSION = 5;
export function lastKnownGoodKey(modelName) {
    return modelName.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-");
}
/**
 * Capture the publication facts proven by an assessment.
 *
 * `spec` supplies the input limit (the assessment has no input gate);
 * when omitted, `input` is `0` and `createLastKnownGoodEntry` backfills it
 * from the spec it stores, so adapters seeding through the legacy
 * single-argument call keep producing valid entries.
 */
export function capturedPublicationVerdict(assessment, spec) {
    return {
        tools: assessment.tools.state,
        reasoning: assessment.reasoning.state,
        inputModalitiesKnown: assessment.inputModalities.known,
        outputModalitiesKnown: assessment.outputModalities.known,
        inputModalities: [...assessment.inputModalities.values],
        outputModalities: [...assessment.outputModalities.values],
        context: assessment.context.value,
        input: spec !== undefined ? Math.floor(spec.limit.input) : 0,
        output: assessment.output.value,
    };
}
export function createLastKnownGoodEntry(group, selected, spec, now = Date.now(), captured, catalog, options) {
    // Capture requires provable group identity from the deployments'
    // own evidence (same model as live publication). A caller cannot
    // register an entry for a group whose identity is incomplete or
    // unprovable, even with a configured-looking spec in hand.
    const evidence = groupIdentityEvidence(group, catalog ?? {});
    if (evidence.status !== "known" || evidence.identity === undefined) {
        throw new Error(`LKG can only be captured from a group with a provable identity (${evidence.reason ?? "identity unknown"})`);
    }
    const raw = captured ?? (catalog !== undefined && options !== undefined
        ? capturedPublicationVerdict(assessModelConfiguration(group, catalog, options), spec)
        : undefined);
    if (!raw) {
        throw new Error("LKG can only be captured from a snapshot that passes current publication policy");
    }
    // The stored input fact is the spec's input limit; a caller that could
    // not know it yet contributes no input fact of its own.
    const proof = {
        ...raw,
        input: raw.input > 0 ? Math.floor(raw.input) : Math.floor(spec.limit.input),
    };
    if (!validateCapturedPublication({ spec, captured: proof }).valid) {
        throw new Error("LKG can only be captured from a snapshot that passes current publication policy");
    }
    const canonicals = [...new Set(candidateModelIDs(group).map(canonicalModelID))];
    return {
        schemaVersion: PUBLICATION_SCHEMA_VERSION,
        modelName: group.modelName,
        stableIdentity: evidence.identity,
        canonicalID: canonicals[0] ?? group.modelName.toLowerCase(),
        providerID: selected?.providerID ?? "litellm-only",
        matchKind: selected?.matchKind,
        fetchedAt: new Date(now).toISOString(),
        fetchedAtEpochMs: now,
        spec: structuredClone(spec),
        captured: proof,
        provenanceDetail: selected
            ? `LKG originally fetched at ${new Date(now).toISOString()} via provider ${selected.providerID} -> model ${selected.modelID}`
            : `LKG originally fetched at ${new Date(now).toISOString()} via LiteLLM-only declarations`,
    };
}
function isCapabilityState(value) {
    return value === "supported" || value === "unsupported" || value === "unknown";
}
function isCapturedVerdict(value) {
    if (!isRecord(value))
        return false;
    return isCapabilityState(value.tools) &&
        isCapabilityState(value.reasoning) &&
        typeof value.inputModalitiesKnown === "boolean" &&
        typeof value.outputModalitiesKnown === "boolean" &&
        Array.isArray(value.inputModalities) &&
        Array.isArray(value.outputModalities) &&
        typeof value.context === "number" &&
        typeof value.input === "number" &&
        typeof value.output === "number";
}
/** Set equality over canonical modality names; array order never matters. */
function sameModalitySet(left, right) {
    const leftSet = new Set(left);
    const rightSet = new Set(right);
    if (leftSet.size !== rightSet.size)
        return false;
    for (const value of leftSet) {
        if (!rightSet.has(value))
            return false;
    }
    return true;
}
/**
 * Re-prove that a stored snapshot still satisfies the current publication
 * completeness policy AND describes the very spec it would restore.
 * Positive limits alone are not enough: unknown tools, reasoning, or
 * modalities, any illegal captured field, and any mismatch between the
 * captured facts and `entry.spec` (limits, tools, reasoning, modality
 * sets) fail closed. A forged fact that merely parses is still rejected.
 */
export function validateCapturedPublication(entry) {
    if (!isCapturedVerdict(entry.captured)) {
        return { valid: false, reason: "LKG completeness verdict is missing or incompatible" };
    }
    if (!(entry.spec.limit.context > 0 && entry.spec.limit.output > 0)) {
        return { valid: false, reason: "LKG operational limits are not positive" };
    }
    if (entry.captured.tools === "unknown") {
        return { valid: false, reason: "LKG tools were unknown when captured" };
    }
    if (entry.captured.reasoning === "unknown") {
        return { valid: false, reason: "LKG reasoning was unknown when captured" };
    }
    if (!entry.captured.inputModalitiesKnown || !entry.captured.outputModalitiesKnown) {
        return { valid: false, reason: "LKG modalities were not known when captured" };
    }
    if (entry.spec.reasoningSupported === "unknown") {
        return { valid: false, reason: "LKG spec reasoning is unknown" };
    }
    // Captured facts must be the facts of the stored spec that restoration
    // actually publishes; a consistent-looking entry with shifted numbers
    // (or shifted sets/verdicts) is forged and never restores.
    if (entry.captured.context !== entry.spec.limit.context ||
        entry.captured.input !== entry.spec.limit.input ||
        entry.captured.output !== entry.spec.limit.output) {
        return { valid: false, reason: "LKG captured limits do not match the stored spec" };
    }
    if ((entry.captured.tools === "supported") !== entry.spec.capabilities.tools) {
        return { valid: false, reason: "LKG captured tools verdict does not match the stored spec" };
    }
    if (entry.captured.reasoning !== entry.spec.reasoningSupported) {
        return { valid: false, reason: "LKG captured reasoning verdict does not match the stored spec" };
    }
    if (!sameModalitySet(entry.captured.inputModalities, entry.spec.capabilities.input)) {
        return { valid: false, reason: "LKG captured input modalities do not match the stored spec" };
    }
    if (!sameModalitySet(entry.captured.outputModalities, entry.spec.capabilities.output)) {
        return { valid: false, reason: "LKG captured output modalities do not match the stored spec" };
    }
    return { valid: true, reason: "captured publication verdict still satisfies current completeness policy" };
}
/**
 * Validate a stored entry against the current discovery inputs.
 * Age is reported but never a validity condition.
 *
 * Identity validity is decided FIRST from the current deployments'
 * own provider-aware evidence — never from `selected`, which is exactly
 * what a metadata outage removes. `selected` only adds a positive
 * provider cross-check when enrichment is available.
 */
export function validateLastKnownGood(entry, group, selected, now = Date.now(), options, catalog) {
    const ageMs = Math.max(0, now - entry.fetchedAtEpochMs);
    if (entry.schemaVersion !== PUBLICATION_SCHEMA_VERSION) {
        return { valid: false, reason: "schema-incompatible LKG entry", ageMs };
    }
    if (typeof entry.modelName !== "string" || entry.modelName.length === 0) {
        return { valid: false, reason: "LKG entry has no provable model identity", ageMs };
    }
    if (lastKnownGoodKey(entry.modelName) !== lastKnownGoodKey(group.modelName)) {
        return { valid: false, reason: `model identity changed (${entry.modelName} != ${group.modelName})`, ageMs };
    }
    // Stable identity from the live deployments alone: works with no
    // enrichment source available. An identity the current group cannot
    // prove, or proves differently (provider namespace included), rejects
    // the entry before any weaker check could accept it.
    const evidence = groupIdentityEvidence(group, catalog ?? {});
    if (evidence.status !== "known" || evidence.identity === undefined) {
        return { valid: false, reason: `LKG identity is not provable (${evidence.reason ?? "identity unknown"})`, ageMs };
    }
    if (evidence.identity !== entry.stableIdentity) {
        return { valid: false, reason: `stable identity changed (${entry.stableIdentity} != ${evidence.identity})`, ageMs };
    }
    const canonicals = [...new Set(candidateModelIDs(group).map(canonicalModelID))];
    const currentCanonical = canonicals[0] ?? group.modelName.toLowerCase();
    if (currentCanonical.toLowerCase() !== entry.canonicalID.toLowerCase()) {
        return { valid: false, reason: `canonical identity changed (${entry.canonicalID} != ${currentCanonical})`, ageMs };
    }
    // Additional cross-check only: when the live catalog is unavailable
    // there is no current provider mapping to compare against; the stored
    // mapping stands with cached provenance. Only a positively selected
    // conflicting provider rejects — never the sole identity proof.
    const currentProvider = selected?.providerID;
    if (currentProvider !== undefined && currentProvider.toLowerCase() !== entry.providerID.toLowerCase()) {
        return { valid: false, reason: `provider identity conflict (${entry.providerID} != ${currentProvider})`, ageMs };
    }
    if (!Number.isFinite(Date.parse(entry.fetchedAt))) {
        return { valid: false, reason: "LKG fetch timestamp is not provable", ageMs };
    }
    const liveConflict = liveCapabilityConflict(group, selected, entry);
    if (liveConflict)
        return { valid: false, reason: liveConflict, ageMs };
    return { valid: true, reason: "identity, provider, schema, and live facts agree", ageMs };
}
/**
 * Illegal live deployment limit values are never hidden behind an LKG
 * restore. Both descriptive (`model_info`) and constraint (`litellm_params`)
 * declarations participate: an illegal declared value is illegal metadata.
 */
function illegalLiveLimit(group) {
    return group.deployments.some((deployment) => ["max_input_tokens", "max_output_tokens", "max_tokens", "max_completion_tokens"].some((key) => {
        const constraint = optionalNumber(deployment.litellmParams[key]);
        if (constraint !== undefined && !(constraint > 0))
            return true;
        const descriptive = optionalNumber(deployment.modelInfo[key]);
        return descriptive !== undefined && !(descriptive > 0);
    }));
}
/** Raw trusted model-level limit from the effective (possibly inherited) record. */
function modelLevelLimit(selected, field) {
    if (!isRecord(selected?.record.limit))
        return undefined;
    return optionalNumber(selected.record.limit[field]);
}
/**
 * Trusted model-level modality set reduced exactly the way the published
 * spec derives it (text baseline + the direction's mapped dimensions), so
 * a live models.dev set compares like-for-like with the captured set.
 */
function modelsDevDerivedModalitySet(selected, direction) {
    const list = modelsDevModalityList(selected, direction);
    if (list === undefined)
        return undefined;
    const dimensions = modalityDimensions(direction);
    const derived = new Set(["text"]);
    for (const dimension of dimensions) {
        if (list.includes(dimension.modality))
            derived.add(dimension.modality);
    }
    return derived;
}
/**
 * Proven endpoint runtime constraints that contradict the captured facts.
 *
 * Only a fact the endpoint itself enforces may invalidate a stored
 * snapshot on its own. Descriptive LiteLLM `model_info` values are
 * secondary evidence: a difference there is a *resolved discrepancy*
 * already recorded by the live assessment, and must not invalidate an
 * otherwise trusted snapshot.
 */
function liveConstraintConflict(group, entry) {
    const captured = entry.captured;
    if (!isCapturedVerdict(captured))
        return "LKG completeness verdict is missing";
    const constrainedTools = group.deployments
        .map((deployment) => optionalBoolean(deployment.litellmParams.supports_function_calling))
        .filter((value) => value !== undefined);
    if (captured.tools !== "unknown" &&
        constrainedTools.some((value) => value !== (captured.tools === "supported"))) {
        return "live runtime constraint on tool calling conflicts with captured LKG";
    }
    const constrainedReasoning = group.deployments
        .map((deployment) => optionalBoolean(deployment.litellmParams.supports_reasoning))
        .filter((value) => value !== undefined);
    if (captured.reasoning !== "unknown" &&
        constrainedReasoning.some((value) => value !== (captured.reasoning === "supported"))) {
        return "live runtime constraint on reasoning conflicts with captured LKG";
    }
    const directions = [
        ["input", new Set(captured.inputModalities)],
        ["output", new Set(captured.outputModalities)],
    ];
    for (const [direction, capturedSet] of directions) {
        for (const dimension of modalityDimensions(direction)) {
            const declared = group.deployments
                .map((deployment) => optionalBoolean(deployment.litellmParams[dimension.key]))
                .filter((value) => value !== undefined);
            // Only an explicitly enforced `false` narrows a captured set; a `true`
            // declaration cannot prove the model has a modality the snapshot lacks.
            if (declared.includes(false) && capturedSet.has(dimension.modality)) {
                return `live runtime constraint removes ${dimension.modality} which the captured LKG declares`;
            }
        }
    }
    // A proven runtime constraint that no longer matches the snapshot is a new
    // enforced fact. Restoring the stored spec would advertise a limit the
    // endpoint does not honour, and patchwork merging is forbidden, so the
    // entry fails closed and the model is withheld until fresh metadata exists.
    const constraintOutput = deploymentConstraintValue(group, RUNTIME_CONSTRAINT_KEYS.output);
    if (captured.output > 0 && constraintOutput !== undefined && constraintOutput !== captured.output) {
        return `live runtime constraint output ${constraintOutput} does not match captured LKG output ${captured.output}`;
    }
    const constraintInput = deploymentConstraintValue(group, RUNTIME_CONSTRAINT_KEYS.input);
    if (captured.input > 0 && constraintInput !== undefined && constraintInput !== captured.input) {
        return `live runtime constraint input ${constraintInput} does not match captured LKG input ${captured.input}`;
    }
    return undefined;
}
/**
 * Positive live *authoritative* declarations that contradict the captured
 * capability verdict. Trusted current model-level facts (record modalities,
 * context/input/output, tool_call, reasoning) are authoritative intrinsic
 * metadata, so a changed value is a genuine new conflict and the whole
 * entry fails closed — no field-level merge.
 *
 * Descriptive LiteLLM declarations never invalidate the entry here: the
 * live assessment already compared them and records them as a resolved
 * discrepancy whenever authority decided against them.
 *
 * Every comparison stays like-for-like inside one capability dimension:
 * - `context` (total context) compares only against the trusted
 *   model-level `limit.context`; a LiteLLM `max_input_tokens` is input
 *   capacity and never proves or contradicts total context.
 * - `output` compares the trusted model-level `limit.output`.
 * - `input` compares the trusted model-level input capacity
 *   (`limit.input`, else total context) against the captured input.
 */
function liveCapabilityConflict(group, selected, entry) {
    if (!isCapturedVerdict(entry.captured))
        return "LKG completeness verdict is missing";
    const captured = entry.captured;
    if (illegalLiveLimit(group))
        return "live limit metadata is illegal; LKG cannot mask invalid metadata";
    const constraintConflict = liveConstraintConflict(group, entry);
    if (constraintConflict)
        return constraintConflict;
    const mdContext = modelLevelLimit(selected, "context");
    const mdInput = modelLevelLimit(selected, "input");
    const mdOutput = modelLevelLimit(selected, "output");
    if (mdContext !== undefined && !(mdContext > 0)) {
        return "live model-level context limit is illegal; LKG cannot mask invalid metadata";
    }
    if (mdOutput !== undefined && !(mdOutput > 0)) {
        return "live model-level output limit is illegal; LKG cannot mask invalid metadata";
    }
    const mdTools = optionalBoolean(selected?.record.tool_call);
    if (mdTools !== undefined && (captured.tools === "supported") !== mdTools) {
        return "live model-level tool declaration conflicts with captured LKG";
    }
    const mdReasoning = modelsDevReasoning(selected);
    if (mdReasoning !== undefined && (captured.reasoning === "supported") !== mdReasoning) {
        return "live model-level reasoning declaration conflicts with captured LKG";
    }
    const mdInputSet = modelsDevDerivedModalitySet(selected, "input");
    if (mdInputSet !== undefined && !sameModalitySet([...mdInputSet], captured.inputModalities)) {
        return "live model-level input modalities conflict with captured LKG";
    }
    const mdOutputSet = modelsDevDerivedModalitySet(selected, "output");
    if (mdOutputSet !== undefined && !sameModalitySet([...mdOutputSet], captured.outputModalities)) {
        return "live model-level output modalities conflict with captured LKG";
    }
    if (captured.context > 0 && mdContext !== undefined && Math.floor(mdContext) !== captured.context) {
        return `live model-level context ${Math.floor(mdContext)} conflicts with captured LKG context ${captured.context}`;
    }
    if (captured.output > 0 && mdOutput !== undefined && Math.floor(mdOutput) !== captured.output) {
        return `live model-level output ${Math.floor(mdOutput)} conflicts with captured LKG output ${captured.output}`;
    }
    if (captured.input > 0) {
        const intrinsicInput = mdInput !== undefined && mdInput > 0
            ? mdInput
            : mdContext !== undefined && mdContext > 0
                ? mdContext
                : undefined;
        if (intrinsicInput !== undefined && Math.floor(intrinsicInput) !== captured.input) {
            return `live model-level input capacity ${Math.floor(intrinsicInput)} conflicts with captured LKG input ${captured.input}`;
        }
    }
    return undefined;
}
export function isLKGEntryCompatible(value) {
    if (!isRecord(value))
        return false;
    return value.schemaVersion === PUBLICATION_SCHEMA_VERSION &&
        typeof value.modelName === "string" &&
        typeof value.stableIdentity === "string" &&
        value.stableIdentity.length > 0 &&
        typeof value.canonicalID === "string" &&
        typeof value.providerID === "string" &&
        typeof value.fetchedAt === "string" &&
        typeof value.fetchedAtEpochMs === "number" &&
        isCapturedVerdict(value.captured);
}
/** In-memory LKG store. Persistence belongs to adapters; validity belongs here. */
export function createLastKnownGoodStore() {
    const entries = new Map();
    return {
        set(key, entry) {
            entries.set(key, structuredClone(entry));
        },
        get(key) {
            const found = entries.get(key);
            return found ? structuredClone(found) : undefined;
        },
        delete(key) {
            entries.delete(key);
        },
        clear() {
            entries.clear();
        },
        size() {
            return entries.size;
        },
    };
}
/**
 * Resolve the final configuration, substituting valid LKG only when live
 * metadata is incomplete/unavailable AND a provably belonging entry exists
 * whose stored spec itself passes completeness.
 */
export function resolveConfigurationWithLKG(assessment, group, catalog, options, store, now = Date.now()) {
    if (assessment.publishable)
        return { assessment };
    if (assessment.status !== "discovered-incomplete" && assessment.status !== "metadata-unavailable") {
        return { assessment };
    }
    const detailed = selectModelsDevRecordDetailed(group, catalog);
    // Same effective record the live assessment uses (canonical inheritance
    // included): model-level facts compared against LKG must be the facts
    // that would be published live today.
    const inherited = resolveInheritedRecord(detailed.selected, catalog);
    const effectiveSelected = inherited
        ? { ...detailed.selected, record: inherited.record }
        : detailed.selected;
    const keys = [lastKnownGoodKey(group.modelName)];
    for (const key of keys) {
        const entry = store.get(key);
        if (!entry || !isLKGEntryCompatible(entry))
            continue;
        const validation = validateLastKnownGood(entry, group, effectiveSelected, now, options, catalog);
        if (!validation.valid)
            continue;
        const captured = validateCapturedPublication(entry);
        if (!captured.valid)
            continue;
        return {
            assessment: {
                ...assessment,
                publishable: true,
                status: "configured-lkg",
                usingLKG: true,
                lkgDetail: `${entry.provenanceDetail} (age ${validation.ageMs}ms), live unavailable: ${assessment.failure?.kind ?? assessment.status}`,
            },
            lkg: entry,
            lkgValidation: validation,
        };
    }
    return { assessment };
}
export function describeAssessment(assessment) {
    const gaps = [...assessment.missingFields, ...assessment.unknownFields, ...assessment.illegalFields];
    return gaps.length === 0
        ? `${assessment.status}: publishable`
        : `${assessment.status}: blocked (${gaps.join(", ")})`;
}
/**
 * Partition discovery output for adapters.
 *
 * Publishable entries are `configured` and `configured-lkg` only, and
 * nothing else. There is no user confirmation, override, or degraded
 * publication path: a model that cannot be proven trustworthy is
 * withheld with its reasons while every other model of the same
 * endpoint is published normally.
 *
 * Adapters must not reimplement this partition; they only map entries to
 * host shapes and still honor the operational-limits guard before host
 * registration.
 */
export function buildPublicationResult(litellmResponse, catalog, options, buildOptions = {}) {
    const now = buildOptions.now ?? Date.now();
    const specs = buildModelSpecs(litellmResponse, catalog, options);
    const groups = groupLiteLLMDeployments(litellmResponse);
    const byID = new Map(specs.map((spec) => [spec.id, spec]));
    const catalogAvailable = catalogHasProviders(catalog);
    const publishable = [];
    const blocked = [];
    const assessments = new Map();
    for (const group of groups) {
        const spec = byID.get(group.modelName);
        if (!spec)
            continue;
        const live = assessModelConfiguration(group, catalog, options, {
            catalogAvailable,
            failure: buildOptions.failure,
        });
        assessments.set(group.modelName, live);
        if (live.publishable) {
            publishable.push({ spec, assessment: live });
            continue;
        }
        if (buildOptions.store) {
            const resolved = resolveConfigurationWithLKG(live, group, catalog, options, buildOptions.store, now);
            if (resolved.assessment.publishable && resolved.lkg) {
                publishable.push({
                    spec: resolved.lkg.spec,
                    assessment: {
                        ...resolved.assessment,
                        identity: live.identity,
                        inheritedFields: live.inheritedFields,
                        inheritanceChain: live.inheritanceChain,
                    },
                });
                assessments.set(group.modelName, resolved.assessment);
                continue;
            }
        }
        blocked.push({ spec, assessment: live });
    }
    publishable.sort((a, b) => a.spec.id.localeCompare(b.spec.id, "en"));
    blocked.sort((a, b) => a.spec.id.localeCompare(b.spec.id, "en"));
    return { publishable, blocked, assessments };
}
/** Host-transport mapping for a publishable reasoning state. Conservative: unknown never reaches here. */
export function hostReasoningFlag(assessment) {
    return assessment.reasoning.state === "supported";
}
/** Host-transport mapping for a publishable tool state. Conservative-disable when unknown. */
export function hostToolsFlag(assessment, legacyTools) {
    return assessment.tools.state === "unknown" ? false : legacyTools;
}
