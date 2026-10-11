import { normalizeModelsDevCatalog } from "./catalog-input.js";
import { isRecord, optionalBoolean, optionalNumber, optionalString } from "./litellm.js";
import { buildVariants, canonicalModelID, relationTargets, releaseTimestamp } from "./modelsdev.js";
import { resolveProtocol } from "./protocol.js";
// Confirmed organization relationships, never model-name or capability tables.
const OFFICIAL_PROVIDER_ALIASES = {
    tencent: ["tencent-tokenhub"], zhipuai: ["zai"],
};
function bare(id) { return id.slice(id.lastIndexOf("/") + 1); }
function records(catalog, providerID) {
    const provider = catalog.providers[providerID];
    return isRecord(provider) && isRecord(provider.models)
        ? Object.entries(provider.models).filter((item) => isRecord(item[1])) : [];
}
function recordCanonical(record) {
    const id = relationTargets(record).canonical;
    return id ? canonicalModelID(id) : undefined;
}
function exactName(key, record, name, canonical) {
    const names = [key, optionalString(record.id)].filter((id) => id !== undefined).map(canonicalModelID);
    if (names.includes(name) || (canonical !== undefined && names.includes(canonical)))
        return true;
    // A documented organization namespace can differ (e.g. z-ai).
    return canonical !== undefined && recordCanonical(record) === canonical && names.some((id) => bare(id) === bare(canonical));
}
function selectRecord(group, catalog) {
    const name = canonicalModelID(group.modelName);
    const keys = Object.keys(catalog.models);
    const exact = keys.filter((key) => canonicalModelID(key) === name);
    let targets = exact.length ? exact : keys.filter((key) => !name.includes("/") && bare(canonicalModelID(key)) === name);
    if (targets.length === 0) {
        targets = [...new Set(Object.keys(catalog.providers).flatMap((providerID) => records(catalog, providerID).flatMap(([key, record]) => {
                if (!exactName(key, record, name))
                    return [];
                const relation = recordCanonical(record);
                return relation ? keys.filter((key) => canonicalModelID(key) === relation) : [];
            })))];
    }
    if (targets.length > 1)
        return { identity: { status: "ambiguous", evidence: "none" } };
    const canonical = targets[0];
    if (!canonical)
        return { identity: { status: "unproven", evidence: "none" } };
    const canonicalID = canonicalModelID(canonical);
    const owner = canonicalID.split("/")[0];
    const identity = { status: "proven", canonicalModelID: canonical,
        evidence: exact.length ? "model-name" : !name.includes("/") && bare(canonicalID) === name ? "registry-unique" : "record-relation" };
    const official = [owner, ...(OFFICIAL_PROVIDER_ALIASES[owner] ?? [])];
    for (const providerID of [...official, "opencode", "openrouter"]) {
        const corresponding = records(catalog, providerID).filter(([, record]) => {
            const relation = recordCanonical(record);
            return relation === undefined || relation === canonicalID;
        });
        const exactRecords = corresponding.filter(([key, record]) => exactName(key, record, name, canonicalID));
        // Renamed official APIs can use explicit canonical relations. Resellers
        // must match the model name, so free/pro/highspeed SKUs stay distinct.
        const aliases = official.includes(providerID) ? corresponding.filter(([, record]) => recordCanonical(record) === canonicalID && record.status !== "deprecated") : [];
        const matches = exactRecords.length ? exactRecords : aliases;
        if (matches.length !== 1)
            continue;
        const [modelID, record] = matches[0];
        return { identity, selected: { providerID, modelID, record, matchedCandidate: group.modelName,
                matchKind: exactRecords.length ? "exact" : "relation",
                selectionSource: providerID === "opencode" ? "opencode-fallback" : providerID === "openrouter" ? "openrouter-fallback" : "canonical-original",
                recordCanonicalID: canonical } };
    }
    return { identity };
}
function field(name, value, basis, status = value === undefined ? "missing" : "selected") {
    return { field: name, value, basis: value === undefined ? "unknown" : basis, status,
        resolution: value === undefined ? `${name} is not declared` : `${basis}: ${name}`,
        discrepancy: false, conflict: status === "unresolved-conflict" };
}
function recordFields(record) {
    const limits = isRecord(record.limit) ? record.limit : {};
    const modalities = isRecord(record.modalities) ? record.modalities : {};
    const result = {};
    for (const key of ["context", "input", "output"]) {
        const raw = limits[key];
        const numeric = optionalNumber(raw);
        const value = numeric === undefined ? undefined : Math.floor(numeric);
        result[`limit.${key}`] = field(`limit.${key}`, value !== undefined && value > 0 ? value : undefined, "models.dev", raw === undefined ? "missing" : value === undefined || value <= 0 ? "illegal" : "selected");
    }
    for (const [name, key] of [["capabilities.tools", "tool_call"], ["reasoning", "reasoning"]]) {
        const raw = record[key];
        result[name] = field(name, optionalBoolean(raw), "models.dev", raw === undefined ? "unknown" : typeof raw === "boolean" ? "selected" : "illegal");
    }
    for (const direction of ["input", "output"]) {
        const raw = modalities[direction];
        const valid = Array.isArray(raw) && raw.every((value) => typeof value === "string");
        result[`capabilities.${direction}`] = field(`capabilities.${direction}`, valid ? raw : undefined, "models.dev", raw === undefined ? "unknown" : valid ? "selected" : "illegal");
    }
    return result;
}
/** Existing independent LiteLLM-only declarations; never fill a selected record. */
function declaredFields(group) {
    const result = { "limit.context": field("limit.context", undefined, "unknown") };
    const aggregate = (name, read) => {
        const values = group.deployments.map((deployment) => read(deployment.modelInfo));
        const declared = values.filter((value) => value !== undefined);
        const different = new Set(declared.map((value) => JSON.stringify(value))).size > 1;
        result[name] = field(name, !different && declared.length === values.length && values.length > 0 ? values[0] : undefined, "litellm-declared", different ? "unresolved-conflict" : declared.length === values.length && values.length > 0 ? "selected" : "unknown");
    };
    aggregate("limit.input", (info) => optionalNumber(info.max_input_tokens));
    aggregate("limit.output", (info) => optionalNumber(info.max_output_tokens) ?? optionalNumber(info.max_tokens));
    aggregate("capabilities.tools", (info) => optionalBoolean(info.supports_function_calling));
    aggregate("reasoning", (info) => optionalBoolean(info.supports_reasoning));
    for (const [direction, mappings] of [
        ["input", [["supports_vision", "image"], ["supports_audio_input", "audio"], ["supports_video_input", "video"], ["supports_pdf_input", "pdf"]]],
        ["output", [["supports_audio_output", "audio"]]],
    ]) {
        aggregate(`capabilities.${direction}`, (info) => mappings.every(([key]) => typeof info[key] === "boolean")
            ? ["text", ...mappings.flatMap(([key, modality]) => info[key] === true ? [modality] : [])] : undefined);
    }
    for (const name of ["limit.input", "limit.output"]) {
        const current = result[name];
        if (typeof current.value === "number" && current.value <= 0)
            result[name] = { ...current, value: undefined, status: "illegal" };
    }
    return result;
}
export function resolveModel(group, catalogInput, options = {}) {
    const catalog = normalizeModelsDevCatalog(catalogInput);
    const protocol = resolveProtocol(group, options.protocolOverrides ?? {});
    const { identity, selected } = catalog.kind === "complete" ? selectRecord(group, catalog) : { identity: { status: "unproven", evidence: "none" }, selected: undefined };
    const fields = selected ? recordFields(selected.record) : declaredFields(group);
    const optionsKnown = Array.isArray(selected?.record.reasoning_options);
    const variants = fields.reasoning?.value === true ? buildVariants(selected, protocol) : [];
    const reasoningLevels = { state: optionsKnown ? "known" : "unknown", values: variants.map(({ id }) => id), variants };
    const rawRelease = selected?.record.release_date;
    const released = releaseTimestamp(selected);
    const release = { released, releaseUnit: rawRelease === undefined ? "none" : released === 0 || typeof rawRelease === "number" ? "unknown" : "unix-ms" };
    const cost = isRecord(selected?.record.cost) ? selected.record.cost : {};
    for (const [name, key] of [["input", "input"], ["output", "output"], ["cacheRead", "cache_read"], ["cacheWrite", "cache_write"]]) {
        const raw = optionalNumber(cost[key]);
        fields[`price.${name}`] = field(`price.${name}`, raw !== undefined && raw >= 0 ? raw : 0, selected ? "models.dev" : "unknown");
    }
    fields.releaseDate = field("releaseDate", released, selected ? "models.dev" : "unknown");
    const essential = ["limit.context", "limit.output", "capabilities.tools", "reasoning", "capabilities.input", "capabilities.output"].map((key) => fields[key]);
    const invalid = essential.some((item) => item.status === "illegal" || item.conflict);
    const complete = essential.every((item) => item.value !== undefined && (!Array.isArray(item.value) || item.value.length > 0));
    const status = identity.status === "ambiguous" ? "ambiguous" : invalid ? "invalid-metadata" : complete ? "configured" : catalog.kind !== "complete" ? "metadata-unavailable" : selected ? "discovered-incomplete" : "unmatched";
    const partial = { group, protocol, catalogKind: catalog.kind, identity, selected, fields, reasoningLevels,
        status, publishable: status === "configured", reasons: essential.filter((item) => item.value === undefined || item.conflict || (Array.isArray(item.value) && item.value.length === 0)).map((item) => item.field),
        discrepancies: [], conflicts: Object.values(fields).filter((item) => item.conflict), release };
    return { ...partial, spec: toModelSpec(partial) };
}
/** Compatibility for callers that already obtained one selected record. */
export function resolveSelectedModel(group, selected) {
    const canonical = selected?.recordCanonicalID ?? (selected ? relationTargets(selected.record).canonical : undefined) ??
        (group.modelName.includes("/") ? canonicalModelID(group.modelName) : (selected?.providerID ?? "unknown") + "/" + canonicalModelID(group.modelName));
    const catalog = selected ? { models: { [canonical]: {} }, providers: { [selected.providerID]: { models: { [selected.modelID]: selected.record } } } } : undefined;
    return resolveModel(group, catalog);
}
export function toModelSpec(resolved) {
    const number = (key) => typeof resolved.fields[key]?.value === "number" ? resolved.fields[key].value : 0;
    const list = (key) => Array.isArray(resolved.fields[key]?.value) ? [...resolved.fields[key].value] : [];
    const reasoning = resolved.fields.reasoning?.value;
    return { id: resolved.group.modelName, name: resolved.group.modelName, protocol: resolved.protocol,
        capabilities: { tools: resolved.fields["capabilities.tools"]?.value === true, input: list("capabilities.input"), output: list("capabilities.output") },
        reasoningSupported: reasoning === undefined ? "unknown" : reasoning === true ? "supported" : "unsupported",
        variants: structuredClone(resolved.reasoningLevels.variants), released: resolved.release.released, releaseUnit: resolved.release.releaseUnit,
        limit: { context: number("limit.context"), input: number("limit.input"), output: number("limit.output") },
        cost: { input: number("price.input"), output: number("price.output"), cacheRead: number("price.cacheRead"), cacheWrite: number("price.cacheWrite") } };
}
