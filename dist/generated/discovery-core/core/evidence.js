import { isRecord, optionalNumber } from "./litellm.js";
import { canonicalModelID } from "./modelsdev.js";
import { resolveSelectedModel } from "./resolve.js";
export const RUNTIME_CONSTRAINT_KEYS = {
    context: [],
    input: [],
    output: [],
    modalityFlags: [],
};
export const NUMERIC_FIELD_DESCRIPTORS = {
    context: {
        field: "limit.context",
        // Dimension isolation (D6): max_input_tokens is input capacity and NEVER
        // becomes limit.context. No LiteLLM key declares total context.
        descriptiveKeys: [],
        constraintKeys: RUNTIME_CONSTRAINT_KEYS.context,
        intrinsicPointer: "limit.context",
    },
    input: {
        field: "limit.input",
        descriptiveKeys: ["max_input_tokens"],
        constraintKeys: RUNTIME_CONSTRAINT_KEYS.input,
        intrinsicPointer: "limit.input",
    },
    output: {
        field: "limit.output",
        descriptiveKeys: ["max_output_tokens", "max_tokens"],
        constraintKeys: RUNTIME_CONSTRAINT_KEYS.output,
        intrinsicPointer: "limit.output",
    },
};
export const INPUT_MODALITY_DIMENSIONS = [
    { key: "supports_vision", modality: "image" },
    { key: "supports_pdf_input", modality: "pdf" },
    { key: "supports_audio_input", modality: "audio" },
    { key: "supports_video_input", modality: "video" },
];
export const OUTPUT_MODALITY_DIMENSIONS = [
    { key: "supports_audio_output", modality: "audio" },
];
export function modalityDimensions(direction) {
    return direction === "input" ? INPUT_MODALITY_DIMENSIONS : OUTPUT_MODALITY_DIMENSIONS;
}
function projection(group, record) {
    const name = canonicalModelID(group.modelName);
    const providerID = name.includes("/") ? name.split("/")[0] : "metadata";
    return resolveSelectedModel(group, record ? { providerID, modelID: group.modelName, record } : undefined);
}
function evidence(item) {
    return { field: item.field, value: item.value, status: item.status, selectedSource: item.basis === "models.dev" ? "models.dev" : item.basis === "litellm-declared" ? "litellm" : "none", resolution: item.resolution, evidence: [] };
}
export function isResolvedDiscrepancy(resolution) { return resolution.status === "resolved-discrepancy"; }
export function isUnresolvedConflict(resolution) { return resolution.status === "unresolved-conflict"; }
export function deploymentNumericValue(deployment, descriptor) {
    for (const key of descriptor.descriptiveKeys) {
        const value = optionalNumber(deployment.modelInfo[key]);
        if (value !== undefined)
            return { value, origin: "descriptive-metadata", key };
    }
    return undefined;
}
export function deploymentNumericEvidence(group, descriptor) {
    return group.deployments.flatMap((deployment) => { const result = deploymentNumericValue(deployment, descriptor); return result ? [{ source: "litellm", origin: result.origin, value: result.value, detail: result.key }] : []; });
}
export function deploymentConstraintValue(_group, _keys) { return undefined; }
export function modelsDevNumeric(selected, pointer) {
    return isRecord(selected?.record.limit) ? optionalNumber(selected.record.limit[pointer.split(".").at(-1)]) : undefined;
}
export function resolveNumericField(input) {
    const item = projection(input.group, input.intrinsic === undefined ? undefined : { limit: { [input.field]: input.intrinsic } }).fields["limit." + input.field];
    return { resolution: evidence(item), value: typeof item.value === "number" ? item.value : undefined, known: item.status === "selected", missing: item.status === "missing", unknown: item.status === "unknown", illegal: item.status === "illegal", conflict: item.conflict, discrepancy: false };
}
export function resolveBooleanField(input) {
    const name = input.field === "reasoning" ? "reasoning" : "capabilities.tools";
    const item = projection(input.group, input.intrinsic === undefined ? undefined : { [name === "reasoning" ? "reasoning" : "tool_call"]: input.intrinsic }).fields[name];
    return { resolution: evidence(item), state: item.value === undefined ? "unknown" : item.value === true ? "supported" : "unsupported", conflict: item.conflict, discrepancy: false };
}
export function resolveModalityField(input) {
    const item = projection(input.group, input.intrinsic === undefined ? undefined : { modalities: { [input.direction]: input.intrinsic } }).fields["capabilities." + input.direction];
    return { resolution: evidence(item), values: Array.isArray(item.value) ? item.value : [], known: item.value !== undefined, discrepancy: false, conflict: item.conflict };
}
export function materialDiscrepancies(resolutions) { return resolutions.filter(isResolvedDiscrepancy); }
export function materialConflicts(resolutions) { return resolutions.filter(isUnresolvedConflict); }
