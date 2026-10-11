import { buildModelSpecs } from "./build.js";
import { normalizeModelsDevCatalog } from "./catalog-input.js";
import { groupLiteLLMDeployments, isRecord } from "./litellm.js";
import { resolveProtocolResolution, resolveProtocolSupport, } from "./protocol.js";
import { assessmentFromResolved } from "./publication.js";
import { resolveModel } from "./resolve.js";
export const DISCOVERY_DIAGNOSTICS_SCHEMA_VERSION = 1;
function field(source, detail) { return { source, detail }; }
function catalogHasRecords(catalog) { return normalizeModelsDevCatalog(catalog).kind === "complete"; }
function modelDiagnostic(group, spec, catalog, options) {
    const resolved = resolveModel(group, catalog, options);
    const selected = resolved.selected;
    const assessment = assessmentFromResolved(resolved);
    const protocol = resolveProtocolResolution(group, options.protocolOverrides);
    const support = resolveProtocolSupport(group);
    const source = (key) => {
        const basis = resolved.fields[key]?.basis;
        return basis === "models.dev" ? field("models.dev", selected ? selected.providerID + "/" + selected.modelID : undefined)
            : basis === "litellm-declared" ? field("litellm") : field("none");
    };
    const issues = [];
    if (!assessment.publishable)
        issues.push({ severity: "warning", stage: "publication", code: "model-not-configured", modelId: group.modelName,
            message: assessment.status === "metadata-unavailable" ? "Model metadata is unavailable; retry discovery."
                : assessment.status === "unmatched" || assessment.status === "ambiguous" ? "No unique metadata record matches this model name."
                    : "Model configuration is missing or has invalid fields: " + [...assessment.missingFields, ...assessment.unknownFields, ...assessment.illegalFields].join(", ") });
    return { issues, diagnostic: {
            id: spec.id, deploymentCount: group.deployments.length, candidates: [group.modelName],
            modelsDev: { matched: selected !== undefined, providerID: selected?.providerID, modelID: selected?.modelID, selectionSource: selected?.selectionSource },
            protocol: { value: spec.protocol, reason: protocol.reason, support, deploymentProtocols: protocol.deployments.map((item) => item.protocol) },
            quality: { identity: { canonicalCandidates: resolved.identity.canonicalModelID ? [resolved.identity.canonicalModelID] : [],
                    canonicalModelID: resolved.identity.canonicalModelID, canonicalStatus: resolved.identity.status, canonicalEvidence: resolved.identity.evidence,
                    matchKind: selected?.matchKind, matchedCandidate: selected?.matchedCandidate },
                reasoning: { supported: assessment.reasoning.state === "supported", source: selected ? "models.dev" : "litellm", conflict: assessment.reasoning.conflict },
                protocolSupport: support, fallback: selected ? "enriched" : "litellm-only", conflicts: [],
                metadataSource: selected ? { providerID: selected.providerID, recordID: selected.modelID } : undefined,
                reasoningLevelsState: resolved.reasoningLevels.state, catalogKind: resolved.catalogKind },
            publication: { status: assessment.status, publishable: assessment.publishable,
                missingFields: assessment.missingFields, unknownFields: assessment.unknownFields, illegalFields: assessment.illegalFields, conflictFields: assessment.conflictFields,
                toolState: assessment.tools.state, reasoningState: assessment.reasoning.state, reasoningLevelsKnown: assessment.reasoning.levelsKnown, reasoningLevels: assessment.reasoning.levels,
                inheritedFields: [], inheritanceChain: [], discrepancies: [], conflicts: assessment.conflicts, deploymentConstraints: [], usingLKG: false },
            provenance: { protocol: field(protocol.reason === "override" ? "override" : protocol.reason === "fallback" || protocol.reason === "mixed-fallback" ? "default" : "litellm"),
                reasoning: source("reasoning"), capabilities: { tools: source("capabilities.tools"), input: source("capabilities.input"), output: source("capabilities.output") },
                context: source("limit.context"), outputLimit: source("limit.output"), release: source("releaseDate"),
                pricing: { input: source("price.input"), output: source("price.output"), cacheRead: source("price.cacheRead"), cacheWrite: source("price.cacheWrite") } },
        } };
}
export function diagnoseModelSpecs(litellmResponse, modelsDevCatalog, options) {
    const models = buildModelSpecs(litellmResponse, modelsDevCatalog, options);
    const groups = groupLiteLLMDeployments(litellmResponse);
    const byID = new Map(models.map((model) => [model.id, model]));
    const modelInfoData = isRecord(litellmResponse) && Array.isArray(litellmResponse.data)
        ? litellmResponse.data
        : undefined;
    const modelInfoValid = modelInfoData !== undefined;
    const responseEntries = modelInfoData?.length ?? 0;
    const deployments = groups.reduce((count, group) => count + group.deployments.length, 0);
    const issues = [];
    if (!modelInfoValid) {
        issues.push({
            severity: "error",
            stage: "model-info",
            code: "model-info-invalid",
            message: "LiteLLM model-info response does not contain a data array.",
        });
    }
    const hasCatalog = catalogHasRecords(modelsDevCatalog);
    const catalogKind = normalizeModelsDevCatalog(modelsDevCatalog).kind;
    if (!hasCatalog) {
        issues.push({
            severity: "warning",
            stage: "models-dev",
            code: catalogKind === "providers-only" ? "models-dev-providers-only" : "models-dev-degraded",
            message: catalogKind === "providers-only"
                ? "models.dev returned an unsupported catalog format; retry with catalog.json."
                : "models.dev metadata is unavailable; retry discovery.",
        });
    }
    issues.push({
        severity: "info",
        stage: "models-list",
        code: "models-list-unused",
        message: "/v1/models is intentionally not used as a discovery source because it can contain stale allow-list entries.",
    });
    const modelDiagnostics = [];
    for (const group of groups) {
        const spec = byID.get(group.modelName);
        if (!spec)
            continue;
        const result = modelDiagnostic(group, spec, modelsDevCatalog, options);
        modelDiagnostics.push(result.diagnostic);
        issues.push(...result.issues);
    }
    modelDiagnostics.sort((left, right) => left.id.localeCompare(right.id, "en"));
    const matched = modelDiagnostics.filter((item) => item.modelsDev.matched).length;
    const protocolFallbacks = modelDiagnostics.filter((item) => item.protocol.reason === "fallback" || item.protocol.reason === "mixed-fallback").length;
    return {
        models,
        diagnostics: {
            schemaVersion: DISCOVERY_DIAGNOSTICS_SCHEMA_VERSION,
            modelInfo: {
                status: modelInfoValid ? "ok" : "invalid",
                primaryPath: "/v1/model/info",
                fallbackPath: "/model/info",
            },
            modelsList: {
                status: "unused",
                path: "/v1/models",
                reason: "Not a trusted discovery source; model-info remains authoritative.",
            },
            modelsDev: { status: hasCatalog ? "ok" : "degraded" },
            stats: {
                responseEntries,
                deployments,
                filteredEntries: Math.max(0, responseEntries - deployments),
                models: models.length,
                modelsDevMatched: matched,
                modelsDevUnmatched: modelDiagnostics.length - matched,
                protocolFallbacks,
            },
            models: modelDiagnostics,
            issues,
        },
    };
}
export function createDiscoveryCacheDiagnostics(input, now = Date.now()) {
    const refreshedAt = input.refreshedAt;
    return {
        source: input.source,
        stale: input.stale ?? (input.source === "stale" || input.source === "snapshot"),
        refreshedAt,
        ageMs: refreshedAt === undefined ? undefined : Math.max(0, now - refreshedAt),
        failureCount: Math.max(0, Math.floor(input.failureCount ?? 0)),
        nextRetryAt: input.nextRetryAt,
        pending: input.pending ?? false,
    };
}
