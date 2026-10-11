/** Compatibility projection of the selected model metadata. */
import { isRecord, optionalBoolean, optionalString } from "./litellm.js";
import { resolveModel } from "./resolve.js";
/** Compatibility projection of the selected model metadata. */
export function canUseSelectedModelsDevPrice(selected) {
    return selected !== undefined;
}
/**
 * Name-prefix provider guesses. Isolated from trusted publication: neither
 * the resolver nor `selectModelsDevRecordDetailed` consults this table.
 */
const LEGACY_FAMILY_COMPATIBILITY_RULES = [
    [/^(?:gpt-|o\d|.*codex)/, "openai"],
    [/^claude-/, "anthropic"],
    [/^gemini-/, "google"],
    [/^grok-/, "xai"],
    [/^glm-/, "zai"],
    [/^deepseek-/, "deepseek"],
    [/^kimi-/, "moonshotai"],
    [/^mimo-/, "xiaomi"],
    [/^minimax-/, "minimax"],
    [/^qwen/, "alibaba"],
];
/**
 * Conservative canonicalization for identity matching only. It deliberately does
 * not strip semantic suffixes such as "-free", dates, sizes, or provider tiers.
 */
export function canonicalModelID(value) {
    return value.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-");
}
export function relationTargets(record) {
    const canonical = optionalString(record.canonical_model_id) ??
        optionalString(record.base_model);
    return { canonical, other: [] };
}
export function candidateModelIDs(group) {
    return [group.modelName];
}
/**
 * Non-publication compatibility helper. Returns a name-prefix provider guess
 * and never participates in trusted identity resolution.
 */
export function legacyFamilyCompatibilityProvider(group) {
    for (const candidate of candidateModelIDs(group)) {
        const normalized = canonicalModelID(candidate);
        const match = LEGACY_FAMILY_COMPATIBILITY_RULES.find(([pattern]) => pattern.test(normalized));
        if (match)
            return match[1];
    }
    return undefined;
}
/** Compatibility projection of the selected model metadata. */
export function selectModelsDevRecord(group, catalog) {
    return selectModelsDevRecordDetailed(group, catalog).selected;
}
/**
 * Explicit reasoning support; options never imply support.
 */
export function modelsDevReasoning(selected) {
    return optionalBoolean(selected?.record.reasoning);
}
export function resolveReasoningSupport(group, selected) {
    const state = resolveReasoningState(group, selected);
    return { supported: state.state === "supported", source: state.source, conflict: state.conflict };
}
function effortVariants(options, protocol) {
    if (!isRecord(options) || options.type !== "effort" || !Array.isArray(options.values))
        return [];
    const key = protocol === "messages" ? "effort" : "reasoningEffort";
    const values = options.values.filter((value) => typeof value === "string");
    return [...new Set(values)].map((value) => ({ id: value, settings: { [key]: value } }));
}
function budgetVariants(options, protocol) {
    if (!isRecord(options) || options.type !== "budget_tokens" || protocol !== "messages")
        return [];
    const raw = isRecord(options) ? options.max : undefined;
    const declaredMax = typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
    const maximum = declaredMax !== undefined && declaredMax > 0 ? Math.floor(declaredMax) : undefined;
    const high = maximum === undefined ? 16000 : Math.min(16000, maximum);
    const result = [
        { id: "high", settings: { thinking: { type: "enabled", budgetTokens: high } } },
    ];
    if (maximum !== undefined && maximum > high) {
        result.push({
            id: "max",
            settings: { thinking: { type: "enabled", budgetTokens: maximum } },
        });
    }
    return result;
}
/** Compatibility projection of the selected model metadata. */
export function buildVariants(selected, protocol) {
    const options = selected?.record.reasoning_options;
    if (selected?.record.reasoning !== true || !Array.isArray(options))
        return [];
    const byID = new Map();
    for (const option of options) {
        for (const variant of [...effortVariants(option, protocol), ...budgetVariants(option, protocol)]) {
            if (!byID.has(variant.id))
                byID.set(variant.id, variant);
        }
    }
    return [...byID.values()];
}
export function releaseTimestamp(selected) {
    const value = selected?.record.release_date;
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value !== "string")
        return 0;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
}
/** Compatibility projection of the selected model metadata. */
export function resolveReasoningState(group, selected) {
    if (selected) {
        const declared = modelsDevReasoning(selected);
        return { state: declared === undefined ? "unknown" : declared ? "supported" : "unsupported", source: "models.dev", conflict: false };
    }
    const aggregated = aggregateTriState(group.deployments.map((deployment) => optionalBoolean(deployment.modelInfo.supports_reasoning)));
    return { state: aggregated.state, source: aggregated.source, conflict: aggregated.conflict };
}
/** Compatibility projection of the selected model metadata. */
export function resolveReasoningLevels(selected, protocol) {
    const options = selected?.record.reasoning_options;
    if (!Array.isArray(options))
        return { known: false, values: [] };
    return { known: true, values: buildVariants(selected, protocol).map((variant) => variant.id) };
}
/** Compatibility projection of the selected model metadata. */
/** Deprecated compatibility helper: provider declarations no longer affect metadata. */
export function groupExplicitProviderConflict(_group) {
    return undefined;
}
/** Compatibility projection of the selected model metadata. */
export function groupIdentityEvidence(group, _catalog) {
    return { status: "known", identity: group.modelName };
}
/**
 * Compatibility wrapper over `groupIdentityEvidence`.
 */
export function groupIdentityConflict(group, catalog) {
    const evidence = groupIdentityEvidence(group, catalog);
    return evidence.status === "known" ? undefined : evidence.reason;
}
/** Compatibility projection of the selected model metadata. */
export function selectModelsDevRecordDetailed(group, catalog) {
    const resolved = resolveModel(group, catalog, {});
    return { outcome: resolved.selected ? "matched" : resolved.identity.status === "ambiguous" ? "ambiguous" : "unmatched",
        selected: resolved.selected, candidates: [group.modelName], matchCount: resolved.selected ? 1 : 0, ambiguousProviders: [] };
}
/** Existing declaration aggregation used only when no record is selected. */
export function aggregateTriState(deploymentValues, modelLevel) {
    const defined = deploymentValues.filter((value) => value !== undefined);
    const hasUnknown = deploymentValues.some((value) => value === undefined);
    const agreesWithModel = modelLevel === undefined || defined.every((value) => value === modelLevel);
    const deploymentConflict = defined.some((value) => value === true) && defined.some((value) => value === false);
    const modelConflict = modelLevel !== undefined && defined.some((value) => value !== modelLevel);
    if (defined.length === 0) {
        if (modelLevel === true)
            return { state: "supported", conflict: false, source: "models.dev" };
        if (modelLevel === false)
            return { state: "unsupported", conflict: false, source: "models.dev" };
        return { state: "unknown", conflict: false, source: "default" };
    }
    if (deploymentConflict || hasUnknown || !agreesWithModel) {
        return {
            state: "unknown",
            conflict: deploymentConflict || modelConflict,
            source: modelLevel === undefined ? "litellm" : "derived",
        };
    }
    return {
        state: defined[0] === true ? "supported" : "unsupported",
        conflict: false,
        source: "litellm",
    };
}
/** Compatibility projection of the selected model metadata. */
export function resolveInheritedRecord(selected, catalog) {
    void selected;
    void catalog;
    return undefined;
}
