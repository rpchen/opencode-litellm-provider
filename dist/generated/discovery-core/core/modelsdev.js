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
        selected.selectionSource === "canonical-original";
}
/**
 * Name-prefix provider guesses. Isolated from trusted publication: neither
 * `selectModelsDevRecord` nor `selectModelsDevRecordDetailed` consults this
 * table. A model name starting with `qwen` is not evidence of `alibaba`.
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
/**
 * Non-publication compatibility helper. Returns a name-prefix provider guess
 * and never participates in trusted identity resolution.
 *
 * Callers that need a publishable identity must use
 * `selectModelsDevRecord` / `selectModelsDevRecordDetailed`.
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
/**
 * Trusted identity resolution. Provider choice uses only verifiable
 * relations: explicit `models_dev_provider`, `canonical_model_id`,
 * alias / equivalent / inherits metadata consumed by matching, OpenRouter,
 * OpenCode, or a genuinely unique remaining record.
 *
 * Model-name prefixes and family substrings never select a provider.
 * Multiple remaining records stay unresolved (`undefined`) so publication
 * can report `ambiguous` instead of guessing.
 */
export function selectModelsDevRecord(group, catalog) {
    return selectModelsDevRecordDetailed(group, catalog).selected;
}
/**
 * Trusted model-level reasoning evidence: explicit `reasoning`, else the
 * presence of `reasoning_options`. `undefined` means the record declares
 * nothing. Exported so LKG conflict detection consumes the same source
 * extraction instead of re-deriving it.
 */
export function modelsDevReasoning(selected) {
    const declared = optionalBoolean(selected?.record.reasoning);
    if (declared !== undefined)
        return declared;
    const options = selected?.record.reasoning_options;
    return Array.isArray(options) && options.length > 0 ? true : undefined;
}
export function resolveReasoningSupport(group, selected) {
    const state = resolveReasoningState(group, selected);
    const explicit = group.deployments.map((deployment) => optionalBoolean(deployment.modelInfo.supports_reasoning));
    const source = explicit.every((value) => value !== undefined)
        ? "litellm"
        : state.source;
    return {
        // Boolean transport cannot carry unknown. Publication uses
        // resolveReasoningState and never treats this false as confirmed.
        supported: state.state === "supported",
        source,
        conflict: state.conflict,
    };
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
/**
 * Tri-state reasoning support, independent from variant levels.
 *
 * Unlike the legacy boolean resolver (which maps "no evidence" to
 * `false`), this resolver reports `unknown` when neither LiteLLM nor
 * models.dev supplies trusted evidence, and when explicit LiteLLM
 * declarations disagree with each other.
 */
export function resolveReasoningState(group, selected) {
    const aggregated = aggregateTriState(group.deployments.map((deployment) => optionalBoolean(deployment.modelInfo.supports_reasoning)), modelsDevReasoning(selected));
    return { state: aggregated.state, source: aggregated.source, conflict: aggregated.conflict };
}
/**
 * Reasoning levels decoupled from support. `known=true` with empty
 * `values` means the model reasons without user-selectable grades; it
 * never implies lack of support. `known=false` means no level metadata
 * was declared at all.
 */
export function resolveReasoningLevels(selected, protocol) {
    const options = selected?.record.reasoning_options;
    if (!Array.isArray(options))
        return { known: false, values: [] };
    return { known: true, values: buildVariants(selected, protocol).map((variant) => variant.id) };
}
function explicitModelsDevProvider(group) {
    return group.deployments
        .map((deployment) => optionalString(deployment.modelInfo.models_dev_provider)?.toLowerCase())
        .find((value) => value !== undefined);
}
/**
 * Group-wide explicit provider evidence. Distinct explicit
 * `models_dev_provider` values inside one deployment group mean the host
 * model identity cannot be stated as one fact: that is a conflict, not a
 * first-deployment choice.
 */
export function groupExplicitProviderConflict(group) {
    const declared = [...new Set(group.deployments
            .map((deployment) => optionalString(deployment.modelInfo.models_dev_provider)?.toLowerCase())
            .filter((value) => value !== undefined))];
    return declared.length > 1 ? { providers: declared } : undefined;
}
/**
 * Normalized identity node used by group identity reconciliation.
 *
 * Unlike `canonicalModelID` (record matching), this keeps the provider
 * namespace: `openai/foo`, `anthropic/foo`, and an unqualified `foo` are
 * three distinct identities until deterministic metadata proves them the
 * same. Never strips a `/` prefix here.
 */
function identityNodeID(value) {
    return value.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-");
}
/**
 * Routed/base identity ids per deployment (base_model first: it is
 * LiteLLM's own declared upstream identity; the routed param is a route).
 *
 * Provider semantics are preserved:
 * - a qualified name keeps its namespace (`openai/foo` stays `openai/foo`);
 * - an unqualified name stays unqualified (`foo`);
 * - an explicit `models_dev_provider` is the deterministic namespace proof
 *   for that deployment, so its names qualify as `<provider>/<name>` and a
 *   pure route prefix never masquerades as an identity.
 *
 * An empty result means the deployment carries no identity evidence at
 * all; callers must treat that as identity-unknown, never as skippable.
 */
function deploymentIdentityIDs(deployment) {
    const declaredProvider = optionalString(deployment.modelInfo.models_dev_provider);
    const provider = declaredProvider !== undefined ? identityNodeID(declaredProvider) : undefined;
    const ids = [];
    const push = (raw) => {
        const trimmed = raw?.trim();
        if (!trimmed)
            return;
        const name = identityNodeID(stripRoutePrefix(trimmed));
        if (!name)
            return;
        if (provider) {
            ids.push(`${provider}/${name}`);
            return;
        }
        const slash = trimmed.indexOf("/");
        const namespace = slash > 0 ? identityNodeID(trimmed.slice(0, slash)) : "";
        ids.push(namespace ? `${namespace}/${name}` : name);
    };
    push(optionalString(deployment.modelInfo.base_model));
    push(optionalString(deployment.litellmParams.model));
    return [...new Set(ids)];
}
/**
 * Group identity evidence. Pure over the group and catalog.
 *
 * Reconciliation runs on the identity equivalence graph: nodes are
 * normalized identity strings (provider namespace preserved), edges come
 * from deployment declarations plus catalog relations
 * (`canonical_model_id`, `aliases`, `equivalent_to`, `equivalents`,
 * `inherits`). Connectivity is symmetric, so the verdict never depends
 * on deployment array order nor on which side of a relation stores the
 * declaration. The graph proves identity membership only — capability
 * values never inherit through it.
 */
export function groupIdentityEvidence(group, catalog) {
    const providerConflict = groupExplicitProviderConflict(group);
    if (providerConflict) {
        return {
            status: "conflict",
            reason: `deployments declare different models_dev_provider values (${providerConflict.providers.join(", ")})`,
        };
    }
    // Every deployment must carry positive identity evidence; an
    // identity-less member is never filtered out of the judgment.
    const idSets = group.deployments.map(deploymentIdentityIDs);
    const identityLess = idSets.filter((ids) => ids.length === 0).length;
    if (identityLess > 0) {
        return {
            status: "unknown",
            reason: `one or more deployments have no provable identity (${identityLess} of ${idSets.length} deployments declare no route, base model, or deterministic provider proof)`,
        };
    }
    const stableIdentity = [...new Set(idSets.flat())].sort().join("|");
    if (idSets.length <= 1) {
        return { status: "known", identity: stableIdentity };
    }
    // Union-find over identity strings. Node identity is the normalized
    // string itself, so a deployment id and a catalog record/target with the
    // same qualified name are the same node without any directionality.
    const parent = [];
    const index = new Map();
    const node = (id) => {
        const found = index.get(id);
        if (found !== undefined)
            return found;
        const created = parent.length;
        parent.push(created);
        index.set(id, created);
        return created;
    };
    const find = (value) => (parent[value] === value ? value : (parent[value] = find(parent[value])));
    const union = (left, right) => {
        const rootLeft = find(left);
        const rootRight = find(right);
        if (rootLeft !== rootRight)
            parent[rootLeft] = rootRight;
    };
    const link = (left, right) => {
        if (left && right && left !== right)
            union(node(left), node(right));
    };
    // Catalog metadata relations. Each record's qualified identity links to
    // its aliases and to relation targets; targets keep their namespace as
    // written (`vendor/foo` never collapses to `foo`). Unqualified alias
    // names qualify with the record's own provider, so an alias can never
    // bridge two different providers' names by accident.
    for (const [providerID, models] of providers(catalog)) {
        const namespace = identityNodeID(providerID);
        if (!namespace)
            continue;
        for (const [key, value] of Object.entries(models)) {
            if (!isRecord(value))
                continue;
            const primary = identityNodeID(optionalString(value.id) ?? key);
            if (!primary)
                continue;
            const recordNode = `${namespace}/${primary}`;
            node(recordNode);
            const aliasKey = identityNodeID(key);
            if (aliasKey && aliasKey !== primary)
                link(recordNode, `${namespace}/${aliasKey}`);
            if (Array.isArray(value.aliases)) {
                for (const alias of value.aliases) {
                    if (typeof alias !== "string")
                        continue;
                    const trimmed = alias.trim();
                    const name = identityNodeID(stripRoutePrefix(trimmed));
                    if (!name)
                        continue;
                    const slash = trimmed.indexOf("/");
                    const aliasNamespace = slash > 0 ? identityNodeID(trimmed.slice(0, slash)) : namespace;
                    link(recordNode, `${aliasNamespace}/${name}`);
                }
            }
            for (const target of inheritanceTargets(value)) {
                const slash = target.indexOf("/");
                if (slash <= 0)
                    continue;
                const targetName = identityNodeID(target.slice(slash + 1));
                if (!targetName)
                    continue;
                link(recordNode, `${identityNodeID(target.slice(0, slash))}/${targetName}`);
            }
        }
    }
    // A deployment's own declarations jointly identify it: one hub node
    // unions its ids, so shared-id and metadata edges reconcile deployments
    // regardless of array order.
    const hubs = idSets.map((ids, position) => {
        const hub = node(` deployment#${position}`);
        for (const id of ids)
            union(hub, node(id));
        return hub;
    });
    const roots = new Set(hubs.map((hub) => find(hub)));
    if (roots.size > 1) {
        return {
            status: "conflict",
            reason: `deployment identities cannot be proven to name the same model (${idSets.map((ids) => ids.join("|")).join(" vs ")})`,
        };
    }
    return { status: "known", identity: stableIdentity };
}
/**
 * Compatibility wrapper over `groupIdentityEvidence`: any non-known
 * state blocks trusted identity the same way. Prefer the evidence form
 * when the unknown/conflict distinction matters.
 */
export function groupIdentityConflict(group, catalog) {
    const evidence = groupIdentityEvidence(group, catalog);
    return evidence.status === "known" ? undefined : evidence.reason;
}
/**
 * Detailed models.dev selection outcome.
 *
 * Trusted precedence is explicit provider > canonical-original >
 * OpenRouter > OpenCode > unique match. Name/family heuristics are not a
 * step. Multiple remaining records stay `ambiguous` instead of collapsing
 * into an arbitrary reseller or a name-prefix provider.
 *
 * Group consistency: distinct explicit `models_dev_provider` values,
 * deployment identities that metadata cannot prove equivalent, or any
 * deployment with no positive identity evidence, make the whole group
 * `ambiguous` — never first-deployment wins, and never a silent pass
 * because no conflict was detected.
 */
export function selectModelsDevRecordDetailed(group, catalog) {
    const candidates = candidateModelIDs(group);
    const allProviders = providers(catalog);
    const identityEvidence = groupIdentityEvidence(group, catalog);
    if (identityEvidence.status !== "known") {
        // Identity-incomplete groups (`unknown`) and unprovable/conflicting
        // groups both stay `ambiguous`: no detected conflict is not proof of
        // identity, and never first-deployment wins.
        return {
            outcome: "ambiguous",
            selected: undefined,
            candidates,
            matchCount: 0,
            ambiguousProviders: [...new Set(group.deployments
                    .map((deployment) => optionalString(deployment.modelInfo.models_dev_provider))
                    .filter((value) => value !== undefined))]
                .sort(),
        };
    }
    for (const candidate of candidates) {
        const matches = allProviders.flatMap(([providerID, models]) => {
            const match = findMatch(models, candidate);
            return match ? [selected(providerID, candidate, match)] : [];
        });
        if (matches.length === 0)
            continue;
        const explicitProvider = explicitModelsDevProvider(group);
        if (explicitProvider) {
            const explicit = matches.find((match) => match.providerID.toLowerCase() === explicitProvider);
            if (explicit)
                return { outcome: "matched", selected: { ...explicit, selectionSource: "explicit-provider" }, candidates, matchCount: matches.length, ambiguousProviders: [] };
        }
        const canonicalProviders = canonicalProviderCandidates(matches);
        if (canonicalProviders.length === 1) {
            const original = matches.find((match) => match.providerID.toLowerCase() === canonicalProviders[0]);
            if (original)
                return { outcome: "matched", selected: { ...original, selectionSource: "canonical-original" }, candidates, matchCount: matches.length, ambiguousProviders: [] };
        }
        const openRouter = matches.find((match) => match.providerID.toLowerCase() === "openrouter");
        if (openRouter)
            return { outcome: "matched", selected: { ...openRouter, selectionSource: "openrouter-fallback" }, candidates, matchCount: matches.length, ambiguousProviders: [] };
        const openCode = matches.find((match) => match.providerID.toLowerCase() === "opencode");
        if (openCode)
            return { outcome: "matched", selected: { ...openCode, selectionSource: "opencode-fallback" }, candidates, matchCount: matches.length, ambiguousProviders: [] };
        if (matches.length === 1)
            return { outcome: "matched", selected: { ...matches[0], selectionSource: "unique-match" }, candidates, matchCount: matches.length, ambiguousProviders: [] };
        return {
            outcome: "ambiguous",
            selected: undefined,
            candidates,
            matchCount: matches.length,
            ambiguousProviders: [...new Set(matches.map((match) => match.providerID))].sort(),
        };
    }
    return { outcome: "unmatched", selected: undefined, candidates, matchCount: 0, ambiguousProviders: [] };
}
/**
 * Tri-state aggregation for one capability across deployments.
 *
 * `undefined` is unknown, not a value that can be dropped. A missing
 * deployment declaration therefore cannot turn the group into supported
 * or unsupported. Model-level evidence fills only an entirely unevidenced
 * group; an explicit deployment disagreement with that evidence stays a
 * conflict.
 */
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
        // All deployments declared and agreed; a corroborating model-level
        // record means litellm and models.dev agree — provenance still names
        // the endpoint declarations as the group evidence.
        source: "litellm",
    };
}
function lookupProviderModels(catalog, providerID) {
    if (!isRecord(catalog))
        return undefined;
    const provider = catalog[providerID];
    if (!isRecord(provider) || !isRecord(provider.models)) {
        const lower = providerID.toLowerCase();
        for (const [key, value] of Object.entries(catalog)) {
            if (key.toLowerCase() === lower && isRecord(value) && isRecord(value.models)) {
                return value.models;
            }
        }
        return undefined;
    }
    return provider.models;
}
function inheritanceTargets(record) {
    const targets = [];
    const push = (value) => {
        if (typeof value === "string" && value.includes("/"))
            targets.push(value);
    };
    push(record.canonical_model_id);
    push(record.inherits);
    const equivalent = record.equivalent_to;
    if (typeof equivalent === "string")
        push(equivalent);
    else if (Array.isArray(equivalent))
        for (const item of equivalent)
            push(item);
    const equivalents = record.equivalents;
    if (Array.isArray(equivalents))
        for (const item of equivalents)
            push(item);
    return [...new Set(targets)];
}
const INHERITABLE_FIELDS = [
    "reasoning",
    "reasoning_options",
    "modalities",
    "limit",
    "tool_call",
    "cost",
    "release_date",
];
/**
 * Deterministic capability inheritance.
 *
 * Only metadata-expressed relations (`canonical_model_id`,
 * `inherits`, `equivalent_to` / `equivalents` naming a
 * `provider/model` identity) may supply missing fields. Name similarity,
 * family membership, or neighbor-model values never inherit. Every
 * inherited field is reported so provenance can name its source.
 */
export function resolveInheritedRecord(selected, catalog) {
    if (!selected)
        return undefined;
    const chain = [];
    const inheritedFields = [];
    const merged = { ...selected.record };
    for (const target of inheritanceTargets(selected.record)) {
        const slash = target.indexOf("/");
        if (slash <= 0)
            continue;
        const providerID = target.slice(0, slash);
        const modelRef = target.slice(slash + 1);
        const models = lookupProviderModels(catalog, providerID);
        if (!models)
            continue;
        const match = findMatch(models, modelRef);
        if (!match || !isRecord(match[1]))
            continue;
        const source = match[1];
        const label = `${providerID}/${match[0]}`;
        for (const field of INHERITABLE_FIELDS) {
            if (merged[field] !== undefined)
                continue;
            if (source[field] === undefined)
                continue;
            merged[field] = source[field];
            inheritedFields.push(field);
        }
        if (inheritedFields.length > 0)
            chain.push(`canonical: ${label}`);
        if (inheritedFields.length > 0)
            break;
    }
    if (inheritedFields.length === 0)
        return undefined;
    return {
        record: merged,
        chain,
        inheritedFields: [...new Set(inheritedFields)],
    };
}
