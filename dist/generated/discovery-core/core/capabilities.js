/**
 * Host-independent capability, limit, modality, and price mapping.
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
    const fallback = new Set(modelsDevModalities(selected, direction));
    const mappings = direction === "input" ? INPUT_MODALITIES : OUTPUT_MODALITIES;
    for (const [field, modality] of mappings) {
        // A proven endpoint constraint (`litellm_params`) is the only LiteLLM
        // declaration that can remove a modality the intrinsic record declares.
        if (optionalBoolean(deployment.litellmParams[field]) === false)
            continue;
        const value = optionalBoolean(deployment.modelInfo[field]);
        if (value === true || fallback.has(modality))
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
function perTokenCost(deployments, fields, fallback) {
    const values = deployments.flatMap((deployment) => {
        for (const field of fields) {
            const value = optionalNumber(deployment.modelInfo[field]);
            if (value !== undefined && value >= 0)
                return [value * 1_000_000];
        }
        return [];
    });
    return values.length > 0 ? Math.max(...values) : (fallback ?? 0);
}
export function mapCapabilities(group, selected, contextTierCap) {
    const mdTools = optionalBoolean(selected?.record.tool_call);
    const declaredTools = group.deployments.map((deployment) => optionalBoolean(deployment.litellmParams.supports_function_calling) ??
        optionalBoolean(deployment.modelInfo.supports_function_calling));
    // Two deployments that explicitly disagree keep the conservative answer:
    // a model-level record cannot prove which route the host will use.
    const toolDisagreement = declaredTools.some((value) => value === true) &&
        declaredTools.some((value) => value === false);
    const constrainedTools = group.deployments.some((deployment) => optionalBoolean(deployment.litellmParams.supports_function_calling) === false);
    // Authoritative intrinsic tool support decides; a proven endpoint
    // constraint (`litellm_params`) narrows it.
    const tools = toolDisagreement
        ? false
        : selected !== undefined && mdTools !== undefined
            ? mdTools && !constrainedTools
            : group.deployments.every((deployment) => (optionalBoolean(deployment.litellmParams.supports_function_calling) ??
                optionalBoolean(deployment.modelInfo.supports_function_calling)) ?? true);
    const inputSets = group.deployments.map((deployment) => deploymentModalities(deployment, selected, "input"));
    const input = intersect(inputSets);
    const output = intersect(group.deployments.map((deployment) => deploymentModalities(deployment, selected, "output")));
    // models.dev distinguishes total context from maximum input. Preserve that
    // distinction when available; LiteLLM max_input_tokens is an input limit.
    // The intrinsic value (models.dev limit.input, else total context) decides;
    // proven deployment constraints narrow it and descriptive declarations
    // only serve as a fallback when no intrinsic value exists.
    const mdContext = modelsDevLimit(selected, "context");
    const mdInput = modelsDevLimit(selected, "input");
    const declaredInput = minimum(group.deployments.map((deployment) => positiveInteger(deployment.modelInfo.max_input_tokens)), 0);
    const constraintInput = minimum(group.deployments.map((deployment) => positiveInteger(deployment.litellmParams.max_input_tokens)), 0);
    let inputLimit = mdInput ?? mdContext ?? declaredInput;
    if (inputLimit === 0)
        inputLimit = constraintInput;
    else if (constraintInput > 0)
        inputLimit = Math.min(inputLimit, constraintInput);
    let context = mdContext ?? inputLimit;
    let effectiveInput = inputLimit;
    if (context > 0 && effectiveInput > 0)
        effectiveInput = Math.min(effectiveInput, context);
    if (contextTierCap) {
        const firstTier = minimum(group.deployments.map(tierPoint), Number.POSITIVE_INFINITY);
        if (Number.isFinite(firstTier)) {
            context = context > 0 ? Math.min(context, firstTier) : firstTier;
            effectiveInput = effectiveInput > 0 ? Math.min(effectiveInput, firstTier) : firstTier;
        }
    }
    const mdOutput = modelsDevLimit(selected, "output");
    const declaredOutput = minimum(group.deployments.map((deployment) => positiveInteger(deployment.litellmParams.max_tokens) ??
        positiveInteger(deployment.litellmParams.max_output_tokens) ??
        positiveInteger(deployment.litellmParams.max_completion_tokens) ??
        positiveInteger(deployment.modelInfo.max_output_tokens) ??
        positiveInteger(deployment.modelInfo.max_tokens)), 0);
    const constraintOutput = minimum(group.deployments.map((deployment) => positiveInteger(deployment.litellmParams.max_tokens) ??
        positiveInteger(deployment.litellmParams.max_output_tokens) ??
        positiveInteger(deployment.litellmParams.max_completion_tokens)), 0);
    let outputLimit = mdOutput ?? declaredOutput;
    if (outputLimit === 0)
        outputLimit = constraintOutput;
    else if (constraintOutput > 0)
        outputLimit = Math.min(outputLimit, constraintOutput);
    return {
        capabilities: { tools, input, output },
        limit: { context, input: effectiveInput, output: outputLimit },
        cost: {
            input: perTokenCost(group.deployments, ["input_cost_per_token"], modelsDevCost(selected, "input")),
            output: perTokenCost(group.deployments, ["output_cost_per_token"], modelsDevCost(selected, "output")),
            cacheRead: perTokenCost(group.deployments, ["cache_read_input_token_cost", "cache_read_cost_per_token"], modelsDevCost(selected, "cache_read")),
            cacheWrite: perTokenCost(group.deployments, ["cache_creation_input_token_cost", "cache_write_input_token_cost"], modelsDevCost(selected, "cache_write")),
        },
    };
}
