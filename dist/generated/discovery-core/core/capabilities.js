/**
 * Host-independent capability, limit, modality, and price mapping.
 *
 * D9: this module no longer resolves independently. `mapCapabilities()` is
 * a legacy projection kept for direct callers and tests; the publication
 * path (`buildModelSpecs`, assessments, diagnostics, LKG) derives every
 * value from the single resolver (`resolveModel()` → `toModelSpec()`).
 *
 * Legacy projection rules (aligned with D6–D8):
 * - No `litellm_params` key narrows anything (D7a proven set is empty).
 *   Only `model_info` descriptive declarations fill gaps.
 * - `max_input_tokens` is input capacity and NEVER becomes `limit.context`.
 * - Operator-declared pricing reads `litellm_params` price keys before
 *   `model_info` keys, highest across deployments (D8).
 * - Unproven provider records never supply facts here either: callers pass
 *   only proven serving records or `undefined`.
 */
import { isRecord, optionalBoolean, optionalNumber, positiveInteger, } from "./litellm.js";
import { canUseSelectedModelsDevPrice, } from "./modelsdev.js";
const INPUT_MODALITIES = [
    ["supports_vision", "image"],
    ["supports_pdf_input", "pdf"],
    ["supports_audio_input", "audio"],
    ["supports_video_input", "video"],
];
const OUTPUT_MODALITIES = [["supports_audio_output", "audio"]];
function modelsDevModalities(selected, direction) {
    const modalities = selected?.record.modalities;
    if (!isRecord(modalities) || !Array.isArray(modalities[direction]))
        return [];
    return modalities[direction].filter((value) => typeof value === "string");
}
function modelsDevLimit(selected, key) {
    const limit = selected?.record.limit;
    return isRecord(limit) ? positiveInteger(limit[key]) : undefined;
}
function modelsDevCost(selected, key) {
    if (!canUseSelectedModelsDevPrice(selected))
        return undefined;
    const cost = selected?.record.cost;
    if (!isRecord(cost))
        return undefined;
    const value = optionalNumber(cost[key]);
    return value !== undefined && value >= 0 ? value : undefined;
}
function deploymentModalities(deployment, selected, direction) {
    const result = new Set(["text"]);
    const authoritative = modelsDevModalities(selected, direction);
    const hasAuthoritativeSet = authoritative.length > 0;
    const mappings = direction === "input" ? INPUT_MODALITIES : OUTPUT_MODALITIES;
    for (const [field, modality] of mappings) {
        // Declared-observable evidence only (`model_info`): operator-configuration
        // keys in `litellm_params` never narrow or add modalities (D7a).
        if (hasAuthoritativeSet) {
            if (authoritative.includes(modality))
                result.add(modality);
            continue;
        }
        if (optionalBoolean(deployment.modelInfo[field]) === true)
            result.add(modality);
    }
    return result;
}
function intersect(sets) {
    if (sets.length === 0)
        return ["text"];
    return [...sets[0]].filter((value) => sets.every((set) => set.has(value)));
}
function minimum(values, fallback = 0) {
    const provided = values.filter((value) => value !== undefined);
    return provided.length > 0 ? Math.min(...provided) : fallback;
}
function tierPoint(deployment) {
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
function perTokenCost(deployments, paramFields, infoFields, fallback) {
    // Operator-declared pricing: litellm_params first, then model_info (D8),
    // highest across deployments.
    for (const fields of [paramFields, infoFields]) {
        const source = fields === paramFields ? "litellmParams" : "modelInfo";
        const values = deployments.flatMap((deployment) => {
            for (const field of fields) {
                const value = optionalNumber(deployment[source][field]);
                if (value !== undefined && value >= 0)
                    return [value * 1_000_000];
            }
            return [];
        });
        if (values.length > 0)
            return Math.max(...values);
    }
    return fallback ?? 0;
}
export function mapCapabilities(group, selected, contextTierCap) {
    const mdTools = optionalBoolean(selected?.record.tool_call);
    // Declared-observable tools evidence: model_info only. litellm_params keys
    // are operator configuration and never decide or narrow tools (D7a).
    const declaredTools = group.deployments.map((deployment) => optionalBoolean(deployment.modelInfo.supports_function_calling));
    const toolDisagreement = declaredTools.some((value) => value === true) &&
        declaredTools.some((value) => value === false);
    // Unknown is never coerced to true: without a record verdict and without
    // unanimous explicit declarations, tools stay false.
    const tools = toolDisagreement
        ? false
        : selected !== undefined && mdTools !== undefined
            ? mdTools
            : declaredTools.length > 0 && declaredTools.every((value) => value === true);
    const inputSets = group.deployments.map((deployment) => deploymentModalities(deployment, selected, "input"));
    const input = intersect(inputSets);
    const output = intersect(group.deployments.map((deployment) => deploymentModalities(deployment, selected, "output")));
    // Dimension isolation (D6): context comes only from models.dev
    // limit.context. LiteLLM max_input_tokens is input capacity and NEVER
    // becomes context here. input comes from models.dev limit.input, else
    // LiteLLM max_input_tokens (same-dimension fill).
    const mdContext = modelsDevLimit(selected, "context");
    const mdInput = modelsDevLimit(selected, "input");
    const declaredInput = minimum(group.deployments.map((deployment) => positiveInteger(deployment.modelInfo.max_input_tokens)), 0);
    const context = mdContext ?? 0;
    const effectiveInput = mdInput ?? declaredInput;
    void effectiveInput;
    let resolvedContext = context;
    let resolvedInput = mdInput ?? declaredInput;
    if (contextTierCap) {
        const firstTier = minimum(group.deployments.map(tierPoint), Number.POSITIVE_INFINITY);
        if (Number.isFinite(firstTier)) {
            resolvedContext = resolvedContext > 0 ? Math.min(resolvedContext, firstTier) : firstTier;
            resolvedInput = resolvedInput > 0 ? Math.min(resolvedInput, firstTier) : firstTier;
        }
    }
    const mdOutput = modelsDevLimit(selected, "output");
    const declaredOutput = minimum(group.deployments.map((deployment) => positiveInteger(deployment.modelInfo.max_output_tokens) ??
        positiveInteger(deployment.modelInfo.max_tokens)), 0);
    const outputLimit = mdOutput ?? declaredOutput;
    return {
        capabilities: { tools, input, output },
        limit: { context: resolvedContext, input: resolvedInput, output: outputLimit },
        cost: {
            input: perTokenCost(group.deployments, ["input_cost_per_token"], ["input_cost_per_token"], modelsDevCost(selected, "input")),
            output: perTokenCost(group.deployments, ["output_cost_per_token"], ["output_cost_per_token"], modelsDevCost(selected, "output")),
            cacheRead: perTokenCost(group.deployments, ["cache_read_input_token_cost"], ["cache_read_input_token_cost", "cache_read_cost_per_token"], modelsDevCost(selected, "cache_read")),
            cacheWrite: perTokenCost(group.deployments, ["cache_creation_input_token_cost"], ["cache_creation_input_token_cost", "cache_write_input_token_cost"], modelsDevCost(selected, "cache_write")),
        },
    };
}
