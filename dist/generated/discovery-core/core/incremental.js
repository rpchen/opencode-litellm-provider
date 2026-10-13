/** Shared, host-independent helpers for model-name incremental discovery. */
import { groupLiteLLMDeployments, isRecord } from "./litellm.js";
/** Return the eligible conversational model identities in stable order. */
export function modelNamesOfResponse(response) {
    return [...new Set(groupLiteLLMDeployments(response).map((group) => group.modelName))]
        .sort((left, right) => left.localeCompare(right, "en"));
}
/** Compare model identities only; deployment/route fields never participate. */
export function modelNameDelta(previous, current) {
    const normalizedCurrent = [...new Set(current)].sort((left, right) => left.localeCompare(right, "en"));
    const previousSet = new Set(previous);
    const currentSet = new Set(normalizedCurrent);
    return {
        current: normalizedCurrent,
        added: normalizedCurrent.filter((name) => !previousSet.has(name)),
        removed: [...previousSet].filter((name) => !currentSet.has(name)).sort((left, right) => left.localeCompare(right, "en")),
        unchanged: new Set(normalizedCurrent.filter((name) => previousSet.has(name))),
    };
}
/** Keep the original response envelope while limiting Core work to identities. */
export function responseForModelNames(response, names) {
    if (!isRecord(response) || !Array.isArray(response.data))
        return response;
    return {
        ...response,
        data: response.data.filter((item) => isRecord(item) && typeof item.model_name === "string" && names.has(item.model_name)),
    };
}
/**
 * Merge a Core publication partition after processing only `processed` identities.
 * `retained` contains current identities whose prior Core result remains valid.
 */
export function mergePublicationResults(previous, processed, retained) {
    if (!previous)
        return processed ?? { publishable: [], blocked: [], assessments: new Map() };
    const publishable = [
        ...previous.publishable.filter((entry) => retained.has(entry.spec.id)),
        ...(processed?.publishable ?? []),
    ].sort((left, right) => left.spec.id.localeCompare(right.spec.id, "en"));
    const blocked = [
        ...previous.blocked.filter((entry) => retained.has(entry.spec.id)),
        ...(processed?.blocked ?? []),
    ].sort((left, right) => left.spec.id.localeCompare(right.spec.id, "en"));
    const assessments = new Map(previous.assessments);
    for (const id of [...assessments.keys()]) {
        if (!retained.has(id))
            assessments.delete(id);
    }
    for (const [id, assessment] of processed?.assessments ?? [])
        assessments.set(id, assessment);
    return { publishable, blocked, assessments };
}
/** A selected-record miss among processed identities requires the latest catalog. */
export function needsCatalogRefresh(result, processed) {
    return [...result.publishable, ...result.blocked]
        .some((entry) => processed.has(entry.spec.id) && entry.assessment.identity.selected === undefined);
}
/**
 * Identify withheld models caused by an unavailable/degraded catalog. A complete
 * catalog with no matching record is a stable identity miss and is not retried by
 * an unchanged model set.
 */
export function temporaryMetadataFailureModelNames(result, diagnostics) {
    if (diagnostics.modelsDev.status !== "degraded")
        return [];
    return result.blocked
        .filter((entry) => entry.assessment.status === "metadata-unavailable")
        .map((entry) => entry.spec.id)
        .sort((left, right) => left.localeCompare(right, "en"));
}
function responseEntryCount(response) {
    return isRecord(response) && Array.isArray(response.data) ? response.data.length : undefined;
}
/** Merge diagnostics without re-resolving retained model identities. */
export function mergeDiscoveryDiagnostics(previous, changed, response, currentNames, processed) {
    const source = changed ?? previous;
    const current = new Set(currentNames);
    const models = [
        ...previous.models.filter((model) => current.has(model.id) && !processed.has(model.id)),
        ...(changed?.models ?? []),
    ].sort((left, right) => left.id.localeCompare(right.id, "en"));
    const modelIssues = [
        ...previous.issues.filter((issue) => issue.modelId !== undefined && current.has(issue.modelId) && !processed.has(issue.modelId)),
        ...(changed?.issues.filter((issue) => issue.modelId !== undefined) ?? []),
    ];
    const groups = groupLiteLLMDeployments(response);
    const deployments = groups.reduce((count, group) => count + group.deployments.length, 0);
    const responseEntries = responseEntryCount(response) ?? source.stats.responseEntries;
    const matched = models.filter((model) => model.modelsDev.matched).length;
    const protocolFallbacks = models.filter((model) => model.protocol.reason === "fallback" || model.protocol.reason === "mixed-fallback").length;
    return {
        ...source,
        modelInfo: {
            ...source.modelInfo,
            status: responseEntryCount(response) === undefined ? "invalid" : "ok",
        },
        stats: {
            ...source.stats,
            responseEntries,
            deployments,
            filteredEntries: Math.max(0, responseEntries - deployments),
            models: models.length,
            modelsDevMatched: matched,
            modelsDevUnmatched: models.length - matched,
            protocolFallbacks,
        },
        models,
        issues: [...source.issues.filter((issue) => issue.modelId === undefined), ...modelIssues],
    };
}
