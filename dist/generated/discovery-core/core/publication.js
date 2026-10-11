/** Publication and recovery use the selected whole-record configuration. */
import { criticalModelFingerprint, hasValidCriticalConfiguration } from "./build.js";
import { normalizeModelCost } from "./capabilities.js";
import { groupLiteLLMDeployments, isRecord } from "./litellm.js";
import { aggregateTriState, } from "./modelsdev.js";
import { resolveModel, toModelSpec, } from "./resolve.js";
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
            message: "model name matches more than one canonical identity",
            fields: ["identity"],
        });
    }
    if (assessment.status === "unmatched") {
        reasons.push({
            code: "identity-unmatched",
            message: "no models.dev record matches this model name",
            fields: ["identity"],
        });
    }
    if (assessment.status === "metadata-unavailable") {
        reasons.push({
            code: "metadata-unavailable",
            message: `metadata source is temporarily unavailable (${assessment.failure?.kind ?? "unavailable"}) and no valid cached configuration exists`,
            fields: ["metadata"],
        });
    }
    if (assessment.status === "discovered-incomplete" || assessment.status === "unmatched") {
        reasons.push({
            code: "incomplete-metadata",
            message: "required model capabilities are missing",
            fields: gaps,
        });
    }
    if (conflictFields.length > 0) {
        reasons.push({
            code: "authoritative-conflict",
            message: "model capability declarations disagree",
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
    return basis === "models.dev" ? { source: "models.dev", detail: resolved.selected ? resolved.selected.providerID + "/" + resolved.selected.modelID + ": " + field : field }
        : basis === "litellm-declared" ? { source: "litellm", detail: field } : { source: "none" };
}
function toEvidenceResolution(field) {
    return {
        field: field.field,
        status: field.status,
        value: Array.isArray(field.value) ? [...field.value] : field.value,
        selectedSource: field.basis === "models.dev"
            ? "models.dev"
            : field.basis === "litellm-declared"
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
    for (const current of [toolsField, reasoningField, inputModalitiesField, outputModalitiesField]) {
        if (current.status === "illegal")
            illegalFields.push(current.field);
        else if (current.basis === "unknown")
            unknownFields.push(current.field);
        else if (Array.isArray(current.value) && current.value.length === 0)
            missingFields.push(current.field);
    }
    const discrepancies = resolved.discrepancies.map(toEvidenceResolution);
    const conflicts = resolved.conflicts.map(toEvidenceResolution);
    const identity = {
        outcome: resolved.selected ? "matched" : resolved.identity.status === "ambiguous" ? "ambiguous" : "unmatched",
        selected: resolved.selected, candidates: [resolved.group.modelName], matchCount: resolved.selected ? 1 : 0, ambiguousProviders: [],
    };
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
        resolvedIdentity: resolved.identity,
        metadataSource: resolved.selected ? { providerID: resolved.selected.providerID, recordID: resolved.selected.modelID, canonicalModelID: resolved.identity.canonicalModelID } : undefined,
        catalogKind: resolved.catalogKind,
        reasoningLevelsState: resolved.reasoningLevels.state,
    };
}
/** True only for `configured` and `configured-lkg`. This is the whole gate. */
export function isNormallyPublishable(status) {
    return status === "configured" || status === "configured-lkg";
}
// ---------------------------------------------------------------------------
// Last Known Good, schema 9
// ---------------------------------------------------------------------------
/** Schema 9 stores whole critical configuration; old policy caches require refresh. */
export const PUBLICATION_SCHEMA_VERSION = 9;
export function lastKnownGoodKey(modelName) {
    return modelName;
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
    if (catalog === undefined || options === undefined)
        throw new Error("LKG capture requires the live catalog and build options");
    const resolved = resolveModel(group, catalog, options);
    if (!resolved.publishable)
        throw new Error("LKG can only capture a configured model");
    const verdict = capturedPublicationVerdict(assessmentFromResolved(resolved), resolved.spec);
    if (criticalModelFingerprint([spec]) !== criticalModelFingerprint([resolved.spec]) ||
        (captured && JSON.stringify(captured) !== JSON.stringify(verdict)))
        throw new Error("LKG configuration differs from the configured model");
    const entry = { schemaVersion: PUBLICATION_SCHEMA_VERSION, modelName: group.modelName,
        configurationFingerprint: criticalModelFingerprint([resolved.spec]), fetchedAt: new Date(now).toISOString(), fetchedAtEpochMs: now,
        spec: structuredClone(resolved.spec), captured: verdict,
        provenanceDetail: resolved.selected ? resolved.selected.providerID + "/" + resolved.selected.modelID : "LiteLLM" };
    if (!validateCapturedPublication(entry).valid)
        throw new Error("LKG configuration is incomplete");
    return entry;
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
 */
export function validateCapturedPublication(entry) {
    if (!hasValidCriticalConfiguration(entry.spec) || !isCapturedVerdict(entry.captured)) {
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
export function isLKGEntryCompatible(value) {
    return isRecord(value) && value.schemaVersion === PUBLICATION_SCHEMA_VERSION &&
        typeof value.modelName === "string" && value.modelName.length > 0 &&
        typeof value.configurationFingerprint === "string" && typeof value.fetchedAt === "string" &&
        typeof value.fetchedAtEpochMs === "number" && Number.isFinite(value.fetchedAtEpochMs) &&
        Number.isFinite(Date.parse(value.fetchedAt)) && isCapturedVerdict(value.captured) &&
        isRecord(value.spec) && isRecord(value.spec.limit) && isRecord(value.spec.capabilities) &&
        Array.isArray(value.spec.capabilities.input) && Array.isArray(value.spec.capabilities.output) &&
        Array.isArray(value.spec.variants) && criticalModelFingerprint([value.spec]) === value.configurationFingerprint &&
        validateCapturedPublication(value).valid;
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
/** Publication and recovery use the selected whole-record configuration. */
export function validateLastKnownGood(entry, group, selected, now = Date.now(), options, catalog) {
    const ageMs = Math.max(0, now - entry.fetchedAtEpochMs);
    if (!isLKGEntryCompatible(entry))
        return { valid: false, reason: "schema or critical configuration is incompatible", ageMs };
    if (entry.modelName !== group.modelName || entry.spec.id !== group.modelName || entry.spec.name !== group.modelName)
        return { valid: false, reason: "model name changed", ageMs };
    return { valid: true, reason: "model name, schema and critical configuration are valid", ageMs };
}
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
    const provenance = { source: "lkg", detail: entry.provenanceDetail };
    const limit = (field, value) => ({
        value, valid: true, missing: false, unknown: false, conflict: false, illegal: false,
        provenance, discrepancy: false,
        resolution: { field, status: "selected", value, selectedSource: "models.dev", resolution: "cached configuration", evidence: [] },
    });
    const modalities = (field, values) => ({
        values, known: true, provenance, discrepancy: false,
        resolution: { field, status: "selected", value: [...values], selectedSource: "models.dev", resolution: "cached configuration", evidence: [] },
    });
    return {
        assessment: {
            ...assessment,
            publishable: true,
            status: "configured-lkg",
            usingLKG: true,
            tools: { state: entry.captured.tools, provenance },
            reasoning: { state: entry.captured.reasoning, levelsKnown: true, levels: entry.spec.variants.map(({ id }) => id),
                provenance, levelsProvenance: provenance, conflict: false },
            context: limit("limit.context", entry.spec.limit.context),
            output: limit("limit.output", entry.spec.limit.output),
            inputModalities: modalities("capabilities.input", entry.spec.capabilities.input),
            outputModalities: modalities("capabilities.output", entry.spec.capabilities.output),
            missingFields: [], unknownFields: [], illegalFields: [], conflictFields: [], discrepancies: [], conflicts: [],
            reasoningLevelsState: "known",
            lkgDetail: `${entry.provenanceDetail} (age ${validation.ageMs}ms), live unavailable: ${assessment.failure?.kind ?? assessment.status}`,
        },
        lkg: { ...entry, spec: { ...entry.spec, cost: normalizeModelCost(entry.spec.cost) } },
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
    const groups = groupLiteLLMDeployments(litellmResponse);
    const publishable = [];
    const blocked = [];
    const assessments = new Map();
    for (const group of groups) {
        const resolved = resolveModel(group, catalog, options);
        const spec = resolved.spec;
        const live = assessmentFromResolved(resolved, buildOptions.failure);
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
export { aggregateTriState, resolveModel, toModelSpec };
