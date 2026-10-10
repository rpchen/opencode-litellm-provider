/**
 * Trusted model-capability publication loop.
 *
 * Single business source of truth for answering: "is this discovered
 * model's metadata reliable enough to publish as a fully configured
 * model?" Covers completeness/publishability policy, false-vs-unknown
 * semantics, deterministic single-resolver derivation, failure taxonomy,
 * TTL-free Last Known Good (schema 8 proof composition), evidence source
 * authority, resolved discrepancies vs unresolved conflicts, and
 * field-level provenance.
 *
 * D9 invariant: the publication assessment is derived from the single
 * `ResolvedModel`. There is no independent parsing here.
 *
 * The publication gate is never relaxed. There is no user confirmation,
 * override, or degraded-publication path: a model that cannot be proven
 * trustworthy is withheld, while every other model of the same endpoint
 * is published normally.
 *
 * No I/O, no timers, no host SDK imports. Adapters consume the verdicts
 * without reimplementing policy.
 */
import { isRecord, optionalNumber, optionalString, groupLiteLLMDeployments, } from "./litellm.js";
import { createHash } from "node:crypto";
import { normalizeModelsDevCatalog } from "./catalog-input.js";
import { aggregateTriState, } from "./modelsdev.js";
import { resolveModel, toModelSpec, } from "./resolve.js";
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
function basisProvenance(basis, field, resolved) {
    switch (basis) {
        case "serving":
            return { source: "models.dev", detail: `${field} -> provider ${resolved.serving.providerID} -> model ${resolved.serving.recordID}` };
        case "canonical":
            return { source: "models.dev", detail: `${field} -> canonical ${resolved.identity.canonicalModelID}` };
        case "litellm-declared":
            return { source: "litellm", detail: `${field} group evidence` };
        case "enforcement-narrowed":
            return { source: "override", detail: `${field} narrowed by a promoted runtime-enforcement key` };
        default:
            return { source: "none", detail: `no trusted ${field} evidence` };
    }
}
function toEvidenceResolution(field) {
    return {
        field: field.field,
        status: field.status,
        value: Array.isArray(field.value) ? [...field.value] : field.value,
        selectedSource: field.basis === "serving" || field.basis === "canonical"
            ? "models.dev"
            : field.basis === "litellm-declared" || field.basis === "enforcement-narrowed"
                ? "litellm"
                : "none",
        resolution: field.resolution,
        evidence: [],
    };
}
function toLimitAssessment(name, field, resolved) {
    const value = typeof field.value === "number" && field.value > 0 ? Math.floor(field.value) : 0;
    const valid = value > 0;
    return {
        value,
        valid,
        missing: !valid && (field.status === "missing"),
        unknown: !valid && field.status === "unknown",
        conflict: field.conflict,
        illegal: field.status === "illegal",
        provenance: basisProvenance(field.basis, field.field, resolved),
        resolution: toEvidenceResolution(field),
        discrepancy: field.discrepancy,
        deploymentConstraint: undefined,
    };
}
/**
 * Assess one deployment group for normal publication.
 *
 * Pure derivation of the single `ResolvedModel`: it never fills defaults to
 * hide gaps and never guesses from names or families.
 */
export function assessModelConfiguration(group, catalog, options, input = { catalogAvailable: true }) {
    const resolved = resolveModel(group, catalog, {
        protocolOverrides: options.protocolOverrides,
        contextTierCap: options.contextTierCap,
    });
    return assessmentFromResolved(resolved, input.failure);
}
export function assessmentFromResolved(resolved, failure) {
    const fields = resolved.fields;
    const context = toLimitAssessment("limit.context", fields["limit.context"], resolved);
    const output = toLimitAssessment("limit.output", fields["limit.output"], resolved);
    const toolsField = fields["capabilities.tools"];
    const toolState = toolsField.basis === "unknown"
        ? "unknown"
        : toolsField.value === true ? "supported" : "unsupported";
    const reasoningField = fields["reasoning"];
    const reasoningState = reasoningField.basis === "unknown"
        ? "unknown"
        : reasoningField.value === true ? "supported" : "unsupported";
    const inputModalitiesField = fields["capabilities.input"];
    const outputModalitiesField = fields["capabilities.output"];
    const inputValues = Array.isArray(inputModalitiesField.value) ? [...inputModalitiesField.value] : [];
    const outputValues = Array.isArray(outputModalitiesField.value) ? [...outputModalitiesField.value] : [];
    const missingFields = [];
    const unknownFields = [];
    const illegalFields = [];
    const conflictFields = [];
    if (!context.valid) {
        if (context.conflict)
            conflictFields.push("limit.context");
        else if (context.illegal)
            illegalFields.push("limit.context");
        else if (context.unknown)
            unknownFields.push("limit.context");
        else
            missingFields.push("limit.context");
    }
    if (!output.valid) {
        if (output.conflict)
            conflictFields.push("limit.output");
        else if (output.illegal)
            illegalFields.push("limit.output");
        else if (output.unknown)
            unknownFields.push("limit.output");
        else
            missingFields.push("limit.output");
    }
    if (toolState === "unknown")
        unknownFields.push("capabilities.tools");
    if (reasoningState === "unknown")
        unknownFields.push("reasoning");
    if (inputModalitiesField.basis === "unknown")
        unknownFields.push("capabilities.input");
    if (outputModalitiesField.basis === "unknown")
        unknownFields.push("capabilities.output");
    const discrepancies = resolved.discrepancies.map(toEvidenceResolution);
    const conflicts = resolved.conflicts.map(toEvidenceResolution);
    // Compat identity: matched only when a serving record is resolved;
    // canonical-only resolution carries no provider record by design.
    const identity = resolved.serving.status === "declared"
        ? {
            outcome: "matched",
            selected: {
                providerID: resolved.serving.providerID,
                modelID: resolved.serving.recordID,
                record: (resolved.serving.record ?? {}),
                matchKind: "exact",
                selectionSource: "explicit-provider",
            },
            candidates: [],
            matchCount: 1,
            ambiguousProviders: [],
        }
        : resolved.identity.status === "ambiguous" || resolved.identity.status === "conflict" || resolved.serving.status === "serving-ambiguous"
            ? { outcome: "ambiguous", selected: undefined, candidates: [], matchCount: 0, ambiguousProviders: resolved.serving.providerID ? [resolved.serving.providerID] : [] }
            : { outcome: "unmatched", selected: undefined, candidates: [], matchCount: 0, ambiguousProviders: [] };
    const fieldBasis = Object.fromEntries(Object.entries(resolved.fields).map(([name, field]) => [name, field.basis]));
    return {
        publishable: resolved.publishable,
        status: resolved.status,
        tools: {
            state: toolState,
            provenance: basisProvenance(toolsField.basis, toolsField.field, resolved),
            resolution: toEvidenceResolution(toolsField),
            discrepancy: toolsField.discrepancy,
        },
        reasoning: {
            state: reasoningState,
            levelsKnown: resolved.reasoningLevels.state === "known",
            levels: [...resolved.reasoningLevels.values],
            provenance: basisProvenance(reasoningField.basis, reasoningField.field, resolved),
            levelsProvenance: resolved.reasoningLevels.state === "known"
                ? { source: "models.dev", detail: "reasoning_options" }
                : { source: "none", detail: "no reasoning level metadata" },
            conflict: reasoningField.conflict,
            resolution: toEvidenceResolution(reasoningField),
            discrepancy: reasoningField.discrepancy,
        },
        context,
        output,
        inputModalities: {
            values: inputValues,
            known: inputModalitiesField.basis !== "unknown",
            provenance: basisProvenance(inputModalitiesField.basis, inputModalitiesField.field, resolved),
            resolution: toEvidenceResolution(inputModalitiesField),
            discrepancy: inputModalitiesField.discrepancy,
        },
        outputModalities: {
            values: outputValues,
            known: outputModalitiesField.basis !== "unknown",
            provenance: basisProvenance(outputModalitiesField.basis, outputModalitiesField.field, resolved),
            resolution: toEvidenceResolution(outputModalitiesField),
            discrepancy: outputModalitiesField.discrepancy,
        },
        identity,
        inheritedFields: [],
        inheritanceChain: [],
        missingFields,
        unknownFields,
        illegalFields,
        conflictFields,
        discrepancies,
        conflicts,
        failure,
        usingLKG: false,
        resolvedIdentity: {
            status: resolved.identity.status,
            canonicalModelID: resolved.identity.canonicalModelID,
            evidence: resolved.identity.evidence,
            adapterSegment: resolved.identity.parse.adapterSegment,
            customLLMProvider: resolved.identity.parse.customLLMProvider,
        },
        resolvedServing: {
            status: resolved.serving.status,
            providerID: resolved.serving.providerID,
            recordID: resolved.serving.recordID,
        },
        fieldBasis,
        operatorConfigurationKeys: [...resolved.operatorConfigurationKeys],
        diagnosticCandidates: resolved.diagnosticCandidates.map((item) => ({ ...item })),
        catalogKind: resolved.catalogKind,
        reasoningLevelsState: resolved.reasoningLevels.state,
    };
}
/** True only for `configured` and `configured-lkg`. This is the whole gate. */
export function isNormallyPublishable(status) {
    return status === "configured" || status === "configured-lkg";
}
// ---------------------------------------------------------------------------
// Last Known Good, schema 8 (D10)
// ---------------------------------------------------------------------------
/**
 * Schema 8: proof records the composition that produced the stored spec,
 * group-wide. Whole-spec restore or nothing; never per-field merges.
 * v7 and older entries fail closed without migration.
 */
export const PUBLICATION_SCHEMA_VERSION = 8;
export function lastKnownGoodKey(modelName) {
    return modelName.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-");
}
/**
 * Capture the publication facts proven by an assessment.
 *
 * `spec` supplies the input limit; when omitted, `input` is `0`.
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
/**
 * Capture an LKG entry. The entry is derived from the SAME resolution that
 * passed the publication gate (5.3): callers pass the catalog and options
 * so Core resolves once and captures from that result. A `withheld`,
 * incomplete, or non-`configured` resolution throws instead of failing
 * silently through drift.
 *
 * The legacy `(group, selected, spec, now, captured)` adapter form keeps
 * working only when `catalog` + `options` are also supplied; otherwise it
 * throws. Adapters migrate their seeding to pass the live catalog/options
 * (downstream tasks).
 */
export function createLastKnownGoodEntry(group, selected, spec, now = Date.now(), captured, catalog, options) {
    void selected;
    if (catalog === undefined || options === undefined) {
        throw new Error("LKG capture requires the live catalog and build options so the entry derives from the same resolution (schema 8)");
    }
    const resolved = resolveModel(group, catalog, {
        protocolOverrides: options.protocolOverrides,
        contextTierCap: options.contextTierCap,
    });
    if (!resolved.publishable || resolved.status !== "configured") {
        throw new Error(`LKG can only be captured from a configured resolution (got ${resolved.status}: ${resolved.reasons.join("; ")})`);
    }
    // The stored spec must be the projection of the same resolution.
    const expected = resolved.spec;
    if (JSON.stringify(captured ?? capturedFromResolved(resolved)) !== JSON.stringify(capturedFromResolved(resolved))) {
        throw new Error("LKG captured verdict diverges from the resolution; refusing to seed through drift");
    }
    void expected;
    if (spec.id !== resolved.spec.id ||
        spec.limit.context !== resolved.spec.limit.context ||
        spec.limit.input !== resolved.spec.limit.input ||
        spec.limit.output !== resolved.spec.limit.output) {
        throw new Error("LKG spec diverges from the resolution spec; refusing to seed through drift");
    }
    const proof = captured ?? capturedFromResolved(resolved);
    if (!validateCapturedPublication({ spec: resolved.spec, captured: proof }).valid) {
        throw new Error("LKG can only be captured from a snapshot that passes current publication policy");
    }
    const stableIdentity = stableGroupIdentity(group);
    return {
        schemaVersion: PUBLICATION_SCHEMA_VERSION,
        modelName: group.modelName,
        stableIdentity,
        proof: resolved.proof,
        fetchedAt: new Date(now).toISOString(),
        fetchedAtEpochMs: now,
        spec: structuredClone(resolved.spec),
        captured: { ...proof, input: proof.input > 0 ? Math.floor(proof.input) : Math.floor(resolved.spec.limit.input) },
        provenanceDetail: resolved.serving.providerID
            ? `LKG originally fetched at ${new Date(now).toISOString()} via provider ${resolved.serving.providerID} -> model ${resolved.serving.recordID}`
            : `LKG originally fetched at ${new Date(now).toISOString()} via ${resolved.identity.canonicalModelID ?? "LiteLLM-only declarations"}`,
    };
}
function capturedFromResolved(resolved) {
    const assessment = assessmentFromResolved(resolved);
    return capturedPublicationVerdict(assessment, resolved.spec);
}
function stableGroupIdentity(group) {
    const ids = group.deployments.flatMap((deployment) => {
        const parts = [];
        const base = optionalString(deployment.modelInfo.base_model);
        if (base)
            parts.push(base.trim().toLowerCase());
        const routed = optionalString(deployment.litellmParams.model);
        if (routed)
            parts.push(routed.trim().toLowerCase());
        const provider = optionalString(deployment.modelInfo.models_dev_provider);
        if (provider)
            parts.push(`provider:${provider.trim().toLowerCase()}`);
        return parts;
    });
    return [...new Set(ids)].sort().join("|");
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
const KNOWN_FIELD_BASIS = new Set(["serving", "canonical", "litellm-declared", "unknown", "enforcement-narrowed"]);
/**
 * Re-prove that a stored snapshot still satisfies the current publication
 * completeness policy AND describes the very spec it would restore.
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
function isLKGProof(value) {
    if (!isRecord(value))
        return false;
    if (!Array.isArray(value.deploymentEvidence))
        return false;
    if (!isRecord(value.fields))
        return false;
    if (typeof value.enforcementFingerprint !== "string")
        return false;
    for (const item of value.deploymentEvidence) {
        if (!isRecord(item))
            return false;
        if (typeof item.deploymentID !== "string")
            return false;
        if (!Array.isArray(item.normalizedInputs))
            return false;
        if (item.identityKind !== "canonical" && item.identityKind !== "litellm-only" && item.identityKind !== "serving-only")
            return false;
        if (item.identityKind === "canonical") {
            if (typeof item.canonicalModelID !== "string")
                return false;
        }
        else if (item.canonicalModelID !== undefined) {
            return false;
        }
    }
    for (const basis of Object.values(value.fields)) {
        if (typeof basis !== "string" || !KNOWN_FIELD_BASIS.has(basis))
            return false;
    }
    if (value.serving !== undefined) {
        if (!isRecord(value.serving))
            return false;
        if (typeof value.serving.providerID !== "string" || typeof value.serving.recordID !== "string")
            return false;
        if (!Array.isArray(value.serving.declarations) || typeof value.serving.recordDigest !== "string")
            return false;
    }
    // identityKind/proof-content consistency (G43): canonical items carry a
    // canonicalModelID; non-canonical items carry no registryDigest.
    const hasCanonical = value.deploymentEvidence.some((item) => isRecord(item) && item.identityKind === "canonical");
    if (!hasCanonical && value.registryDigest !== undefined)
        return false;
    if (value.registryDigest !== undefined && typeof value.registryDigest !== "string")
        return false;
    if (value.litellmFingerprint !== undefined && typeof value.litellmFingerprint !== "string")
        return false;
    return true;
}
export function isLKGEntryCompatible(value) {
    if (!isRecord(value))
        return false;
    return value.schemaVersion === PUBLICATION_SCHEMA_VERSION &&
        typeof value.modelName === "string" &&
        typeof value.stableIdentity === "string" &&
        value.stableIdentity.length > 0 &&
        isLKGProof(value.proof) &&
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
 * Validate a stored entry against the current discovery inputs.
 * Age is reported but never a validity condition.
 *
 * Group-wide whole-entry re-proof (D10), in two modes:
 * - outage (catalog `unavailable`/`providers-only`): the registry and
 *   serving records cannot be re-read, so the stored identityKind,
 *   registryDigest, and recordDigest stand as captured. Re-proved per
 *   component: the deployment-evidence multiset (deploymentID +
 *   normalizedInputs, item by item, order-independent), every stored
 *   serving declaration against the live deployments' declared providers,
 *   the enforcement fingerprint (empty while D7a is unpromoted), and the
 *   LiteLLM fingerprint recomputed from the live group. Restore is the
 *   whole stored spec or nothing.
 * - live (catalog `complete`): additionally the live resolution's proof
 *   must agree item by item — same identityKinds and canonicalModelIDs,
 *   same registryDigest, same serving recordDigest.
 */
export function validateLastKnownGood(entry, group, selected, now = Date.now(), options, catalog) {
    void selected;
    const ageMs = Math.max(0, now - entry.fetchedAtEpochMs);
    if (entry.schemaVersion !== PUBLICATION_SCHEMA_VERSION) {
        return { valid: false, reason: "schema-incompatible LKG entry", ageMs };
    }
    if (!isLKGEntryCompatible(entry)) {
        return { valid: false, reason: "LKG entry proof is missing or malformed", ageMs };
    }
    if (typeof entry.modelName !== "string" || entry.modelName.length === 0) {
        return { valid: false, reason: "LKG entry has no provable model identity", ageMs };
    }
    if (lastKnownGoodKey(entry.modelName) !== lastKnownGoodKey(group.modelName)) {
        return { valid: false, reason: `model identity changed (${entry.modelName} != ${group.modelName})`, ageMs };
    }
    if (stableGroupIdentity(group) !== entry.stableIdentity) {
        return { valid: false, reason: `stable identity changed (${entry.stableIdentity} != ${stableGroupIdentity(group)})`, ageMs };
    }
    if (!Number.isFinite(Date.parse(entry.fetchedAt))) {
        return { valid: false, reason: "LKG fetch timestamp is not provable", ageMs };
    }
    // Illegal live limits are never masked by a restore.
    if (illegalLiveLimit(group)) {
        return { valid: false, reason: "live limit metadata is illegal; LKG cannot mask invalid metadata", ageMs };
    }
    // Live deployment descriptors (no catalog needed): deploymentID +
    // normalizedInputs per deployment, plus the declared serving provider.
    const liveDescriptors = liveDeploymentDescriptors(group);
    const storedItems = entry.proof.deploymentEvidence;
    if (!sameDescriptorMultiset(storedItems, liveDescriptors)) {
        return { valid: false, reason: "LKG deployment evidence multiset changed; whole entry rejected", ageMs };
    }
    // Every stored serving declaration must still be declared by the
    // corresponding live deployment.
    if (entry.proof.serving) {
        const liveByID = new Map(liveDescriptors.map((item) => [item.deploymentID, item.declaredProvider]));
        for (const decl of entry.proof.serving.declarations) {
            if (liveByID.get(decl.deploymentID) !== decl.declared) {
                return { valid: false, reason: "LKG serving declaration no longer declared by the live deployment", ageMs };
            }
        }
    }
    // Enforcement fingerprint: operator-configuration keys never enter it
    // while the D7a proven set is empty, so any operator reconfiguration
    // keeps the entry valid (G20d).
    if (entry.proof.enforcementFingerprint !== emptyEnforcementFingerprint()) {
        return { valid: false, reason: "LKG enforcement fingerprint changed; whole entry rejected", ageMs };
    }
    // LiteLLM fingerprint recomputed from the live group alone.
    const liveLitellmFingerprint = entry.proof.litellmFingerprint !== undefined
        ? liveLitellmFingerprintOf(group)
        : undefined;
    if ((entry.proof.litellmFingerprint ?? null) !== (liveLitellmFingerprint ?? null)) {
        return { valid: false, reason: "LKG LiteLLM declarations changed; whole entry rejected", ageMs };
    }
    // Live catalog available: re-prove the catalog-bound components too.
    if (catalog !== undefined && normalizeModelsDevCatalog(catalog).kind === "complete") {
        const live = resolveModel(group, catalog, {
            protocolOverrides: options?.protocolOverrides ?? {},
            contextTierCap: options?.contextTierCap ?? false,
        });
        const liveProof = live.proof;
        if (!sameKindMultiset(storedItems, liveProof.deploymentEvidence)) {
            return { valid: false, reason: "LKG identity kinds no longer re-prove against the live catalog", ageMs };
        }
        if ((entry.proof.registryDigest ?? null) !== (liveProof.registryDigest ?? null)) {
            return { valid: false, reason: "LKG registry facts changed; whole entry rejected", ageMs };
        }
        const storedServing = entry.proof.serving;
        const liveServing = liveProof.serving;
        if ((storedServing === undefined) !== (liveServing === undefined)) {
            return { valid: false, reason: "LKG serving composition changed; whole entry rejected", ageMs };
        }
        if (storedServing && liveServing) {
            if (storedServing.providerID.toLowerCase() !== liveServing.providerID.toLowerCase() ||
                storedServing.recordID !== liveServing.recordID ||
                storedServing.recordDigest !== liveServing.recordDigest) {
                return { valid: false, reason: "LKG serving record facts changed; whole entry rejected", ageMs };
            }
        }
    }
    return { valid: true, reason: "identity, proof, schema, and live facts agree", ageMs };
}
function liveDeploymentDescriptors(group) {
    return group.deployments.map((deployment) => {
        const candidates = deploymentCandidatesOf(deployment);
        const normalizedInputs = [...new Set(candidates.map((value) => value.toLowerCase()))].sort();
        const id = optionalString(deployment.modelInfo.id);
        return {
            deploymentID: id && id.trim() ? `model_info.id:${id.trim()}` : `evidence:${stableDigestOf([...normalizedInputs].sort())}`,
            normalizedInputs,
            declaredProvider: (optionalString(deployment.modelInfo.models_dev_provider) ?? "").toLowerCase(),
        };
    });
}
function deploymentCandidatesOf(deployment) {
    const values = [];
    const base = optionalString(deployment.modelInfo.base_model);
    if (base?.trim())
        values.push(base.trim());
    const routed = optionalString(deployment.litellmParams.model);
    if (routed?.trim())
        values.push(routed.trim());
    return values;
}
function sameDescriptorMultiset(stored, live) {
    if (stored.length !== live.length)
        return false;
    const normalize = (items) => items.map((item) => JSON.stringify({
        deploymentID: item.deploymentID,
        normalizedInputs: [...item.normalizedInputs].sort(),
    })).sort();
    const a = normalize(stored);
    const b = normalize(live);
    return a.length === b.length && a.every((value, index) => value === b[index]);
}
function sameKindMultiset(stored, live) {
    if (stored.length !== live.length)
        return false;
    const normalize = (items) => items.map((item) => JSON.stringify({
        deploymentID: item.deploymentID,
        identityKind: item.identityKind,
        canonicalModelID: item.canonicalModelID ?? null,
    })).sort();
    const a = normalize(stored);
    const b = normalize(live);
    return a.length === b.length && a.every((value, index) => value === b[index]);
}
function stableDigestOf(value) {
    const stable = (input) => {
        if (Array.isArray(input))
            return input.map(stable);
        if (typeof input !== "object" || input === null)
            return input;
        return Object.fromEntries(Object.entries(input)
            .sort(([a], [b]) => a.localeCompare(b, "en"))
            .map(([k, v]) => [k, stable(v)]));
    };
    return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex").slice(0, 32);
}
/** Frozen empty enforcement fingerprint (D7a proven set is empty). */
function emptyEnforcementFingerprint() {
    return `sha256:${stableDigestOf({ proven: [] })}`;
}
function liveLitellmFingerprintOf(group) {
    // Must stay byte-identical to litellmDeclaredMaterial in resolve.ts (same
    // key precedence: mirrored pricing params BEFORE model_info, matching the
    // D8 price resolution; entries sorted so deployment reorders keep the
    // digest stable).
    const entries = group.deployments.map((deployment) => ({
        max_input_tokens: deployment.modelInfo.max_input_tokens ?? null,
        max_output_tokens: deployment.modelInfo.max_output_tokens ?? deployment.modelInfo.max_tokens ?? null,
        supports_function_calling: deployment.modelInfo.supports_function_calling ?? null,
        supports_reasoning: deployment.modelInfo.supports_reasoning ?? null,
        supports_vision: deployment.modelInfo.supports_vision ?? null,
        supports_pdf_input: deployment.modelInfo.supports_pdf_input ?? null,
        supports_audio_input: deployment.modelInfo.supports_audio_input ?? null,
        supports_video_input: deployment.modelInfo.supports_video_input ?? null,
        supports_audio_output: deployment.modelInfo.supports_audio_output ?? null,
        input_cost_per_token: deployment.litellmParams.input_cost_per_token ?? deployment.modelInfo.input_cost_per_token ?? null,
        output_cost_per_token: deployment.litellmParams.output_cost_per_token ?? deployment.modelInfo.output_cost_per_token ?? null,
        cache_read_input_token_cost: deployment.litellmParams.cache_read_input_token_cost ?? deployment.modelInfo.cache_read_input_token_cost ?? null,
        cache_creation_input_token_cost: deployment.litellmParams.cache_creation_input_token_cost ?? deployment.modelInfo.cache_creation_input_token_cost ?? null,
    }));
    return `sha256:${stableDigestOf(entries.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "en")))}`;
}
/**
 * Illegal live deployment limit values are never hidden behind an LKG
 * restore. Only declared-observable `model_info` limits participate:
 * unproven operator-configuration `litellm_params` keys are NOT capability
 * evidence (D7a empty proven set), so their non-positive values never veto
 * a restore (G20d: operator reconfiguration keeps the entry valid). A
 * non-positive operator key is a diagnostics issue, not a gate.
 */
function illegalLiveLimit(group) {
    return group.deployments.some((deployment) => ["max_input_tokens", "max_output_tokens", "max_tokens"].some((key) => {
        const descriptive = optionalNumber(deployment.modelInfo[key]);
        return descriptive !== undefined && !(descriptive > 0);
    }));
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
    const key = lastKnownGoodKey(group.modelName);
    const entry = store.get(key);
    if (!entry || !isLKGEntryCompatible(entry))
        return { assessment };
    const validation = validateLastKnownGood(entry, group, undefined, now, options, catalog);
    if (!validation.valid)
        return { assessment };
    const captured = validateCapturedPublication(entry);
    if (!captured.valid)
        return { assessment };
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
export function describeAssessment(assessment) {
    const gaps = [...assessment.missingFields, ...assessment.unknownFields, ...assessment.illegalFields];
    return gaps.length === 0
        ? `${assessment.status}: publishable`
        : `${assessment.status}: blocked (${gaps.join(", ")})`;
}
/**
 * Partition discovery output for adapters. Derived from the single
 * resolver: publishable specs equal `toModelSpec(resolved)`.
 *
 * Publishable entries are `configured` and `configured-lkg` only, and
 * nothing else. There is no user confirmation, override, or degraded
 * publication path.
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
    const publishable = [];
    const blocked = [];
    const assessments = new Map();
    for (const group of groups) {
        const spec = byID.get(group.modelName);
        if (!spec)
            continue;
        const live = assessModelConfiguration(group, catalog, options, {
            catalogAvailable: true,
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
export { aggregateTriState };
export { resolveModel, toModelSpec };
