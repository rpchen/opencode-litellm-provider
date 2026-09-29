/**
 * Host-independent models.dev record selection and reasoning variant extraction.
 */
import { isRecord, optionalBoolean, optionalNumber, optionalString, stripRoutePrefix, } from "./litellm.js";
/**
 * Whether provider-scoped models.dev pricing can be treated as a plausible
 * fallback for the deployed model. Gateway/reseller records selected only for
 * capability enrichment must never masquerade as the LiteLLM route price.
 */
export function canUseSelectedModelsDevPrice(selected) {
    // Undefined is kept for backwards-compatible direct callers/tests that
    // construct SelectedModelRecord manually without going through the selector.
    return selected?.selectionSource === undefined ||
        selected.selectionSource === "explicit-provider" ||
        selected.selectionSource === "canonical-original" ||
        selected.selectionSource === "family-original";
}
const FAMILY_RULES = [
    [/^(?:gpt-|o\d|.*codex)/, { primary: "openai", alternatives: [] }],
    [/^claude-/, { primary: "anthropic", alternatives: [] }],
    [/^gemini-/, { primary: "google", alternatives: [] }],
    [/^grok-/, { primary: "xai", alternatives: [] }],
    [/^glm-/, { primary: "zai", alternatives: ["zhipuai"] }],
    [/^deepseek-/, { primary: "deepseek", alternatives: [] }],
    [/^kimi-/, { primary: "moonshotai", alternatives: ["moonshotai-cn"] }],
    [/^mimo-/, { primary: "xiaomi", alternatives: [] }],
    [/^minimax-/, { primary: "minimax", alternatives: ["minimax-cn"] }],
    [/^qwen/, { primary: "alibaba", alternatives: ["alibaba-cn"] }],
];
function providers(catalog) {
    if (!isRecord(catalog))
        return [];
    return Object.entries(catalog).flatMap(([providerID, provider]) => {
        if (!isRecord(provider) || !isRecord(provider.models))
            return [];
        return [[providerID, provider.models]];
    });
}
/**
 * Conservative canonicalization for identity matching only. It deliberately does
 * not strip semantic suffixes such as "-free", dates, sizes, or provider tiers.
 */
export function canonicalModelID(value) {
    return stripRoutePrefix(value.trim())
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, "-")
        .replace(/-+/g, "-");
}
function recordAliases(key, value) {
    const aliases = Array.isArray(value.aliases)
        ? value.aliases.filter((item) => typeof item === "string" && item.length > 0)
        : [];
    return [key, optionalString(value.id), ...aliases].filter((item) => item !== undefined);
}
function findMatch(models, candidate) {
    const raw = stripRoutePrefix(candidate.trim()).toLowerCase();
    const canonical = canonicalModelID(candidate);
    for (const [key, value] of Object.entries(models)) {
        if (!isRecord(value))
            continue;
        const id = optionalString(value.id) ?? key;
        const aliases = recordAliases(key, value);
        for (const alias of aliases) {
            const normalizedAlias = stripRoutePrefix(alias.trim()).toLowerCase();
            if (normalizedAlias === raw) {
                const kind = alias === key || alias === optionalString(value.id) ? "exact" : "alias";
                return [id, value, kind];
            }
        }
        for (const alias of aliases) {
            if (canonicalModelID(alias) === canonical) {
                const kind = alias === key || alias === optionalString(value.id) ? "canonical" : "alias";
                return [id, value, kind];
            }
        }
    }
    return undefined;
}
export function candidateModelIDs(group) {
    const result = [];
    const seen = new Set();
    const add = (value) => {
        if (!value)
            return;
        const normalized = value.toLowerCase();
        if (seen.has(normalized))
            return;
        seen.add(normalized);
        result.push(value);
    };
    for (const deployment of group.deployments) {
        add(optionalString(deployment.modelInfo.base_model));
        const routed = optionalString(deployment.litellmParams.model);
        add(routed ? stripRoutePrefix(routed) : undefined);
    }
    add(group.modelName);
    return result;
}
export function familyProviders(group) {
    for (const deployment of group.deployments) {
        const explicit = optionalString(deployment.modelInfo.models_dev_provider);
        if (explicit)
            return { primary: explicit, alternatives: [] };
    }
    for (const candidate of candidateModelIDs(group)) {
        const normalized = canonicalModelID(candidate);
        const match = FAMILY_RULES.find(([pattern]) => pattern.test(normalized));
        if (match)
            return match[1];
    }
    return undefined;
}
function selected(providerID, candidate, match, selectionSource) {
    return {
        providerID,
        modelID: match[0],
        record: match[1],
        matchedCandidate: candidate,
        matchKind: match[2],
        selectionSource,
    };
}
function canonicalProviderCandidates(matches) {
    const providers = new Set();
    for (const match of matches) {
        const canonical = optionalString(match.record.canonical_model_id);
        if (!canonical)
            continue;
        const slash = canonical.indexOf("/");
        if (slash <= 0)
            continue;
        providers.add(canonical.slice(0, slash).toLowerCase());
    }
    return [...providers];
}
export function selectModelsDevRecord(group, catalog) {
    const allProviders = providers(catalog);
    const family = familyProviders(group);
    const heuristicPreferred = family ? [family.primary, ...family.alternatives] : [];
    for (const candidate of candidateModelIDs(group)) {
        const matches = allProviders.flatMap(([providerID, models]) => {
            const match = findMatch(models, candidate);
            return match ? [selected(providerID, candidate, match)] : [];
        });
        if (matches.length === 0)
            continue;
        // 1. Explicit provider metadata from LiteLLM always wins.
        const explicitProvider = group.deployments
            .map((deployment) => optionalString(deployment.modelInfo.models_dev_provider)?.toLowerCase())
            .find((value) => value !== undefined);
        if (explicitProvider) {
            const explicit = matches.find((match) => match.providerID.toLowerCase() === explicitProvider);
            if (explicit)
                return { ...explicit, selectionSource: "explicit-provider" };
        }
        // 2. Prefer an original provider inferred from models.dev's own
        // canonical_model_id metadata. This avoids requiring a hard-coded family
        // rule every time models.dev adds a new model family.
        const canonicalProviders = canonicalProviderCandidates(matches);
        if (canonicalProviders.length === 1) {
            const original = matches.find((match) => match.providerID.toLowerCase() === canonicalProviders[0]);
            if (original)
                return { ...original, selectionSource: "canonical-original" };
        }
        // 3. Legacy family heuristics remain only as a compatibility fallback for
        // older/synthetic catalogs that do not carry canonical_model_id.
        for (const providerID of heuristicPreferred) {
            const preferred = matches.find((match) => match.providerID.toLowerCase() === providerID.toLowerCase());
            if (preferred)
                return { ...preferred, selectionSource: "family-original" };
        }
        // 4. When the original provider is not present, prefer capability-rich,
        // broadly maintained gateway records in the agreed stable order.
        const openRouter = matches.find((match) => match.providerID.toLowerCase() === "openrouter");
        if (openRouter)
            return { ...openRouter, selectionSource: "openrouter-fallback" };
        const openCode = matches.find((match) => match.providerID.toLowerCase() === "opencode");
        if (openCode)
            return { ...openCode, selectionSource: "opencode-fallback" };
        // 5. A genuinely unique remaining match is safe; otherwise keep the
        // ambiguity observable instead of choosing an arbitrary reseller.
        if (matches.length === 1)
            return { ...matches[0], selectionSource: "unique-match" };
    }
    return undefined;
}
function modelsDevReasoning(selected) {
    const declared = optionalBoolean(selected?.record.reasoning);
    if (declared !== undefined)
        return declared;
    const options = selected?.record.reasoning_options;
    return Array.isArray(options) && options.length > 0 ? true : undefined;
}
export function resolveReasoningSupport(group, selected) {
    const modelsDev = modelsDevReasoning(selected);
    const explicit = group.deployments.map((deployment) => optionalBoolean(deployment.modelInfo.supports_reasoning));
    const conflict = modelsDev !== undefined &&
        explicit.some((value) => value !== undefined && value !== modelsDev);
    const supported = explicit.every((value) => value ?? modelsDev ?? false);
    if (explicit.every((value) => value !== undefined)) {
        return { supported, source: "litellm", conflict };
    }
    if (explicit.every((value) => value === undefined) && modelsDev !== undefined) {
        return { supported, source: "models.dev", conflict };
    }
    if (explicit.some((value) => value !== undefined) || modelsDev !== undefined) {
        return { supported, source: "derived", conflict };
    }
    return { supported: false, source: "default", conflict: false };
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
    const declaredMax = optionalNumber(options.max);
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
export function buildVariants(selected, protocol) {
    const options = selected?.record.reasoning_options;
    if (!Array.isArray(options))
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
