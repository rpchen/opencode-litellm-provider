import { buildModelSpecs, hasOperationalLimits } from "./build.js";
import { groupLiteLLMDeployments, isRecord, optionalBoolean, optionalNumber, positiveInteger, } from "./litellm.js";
import { buildVariants, canUseSelectedModelsDevPrice, candidateModelIDs, canonicalModelID, resolveReasoningSupport, selectModelsDevRecord, } from "./modelsdev.js";
import { resolveProtocolResolution, resolveProtocolSupport, } from "./protocol.js";
export const DISCOVERY_DIAGNOSTICS_SCHEMA_VERSION = 1;
function field(source, detail) {
    return detail ? { source, detail } : { source };
}
function catalogAvailable(catalog) {
    if (!isRecord(catalog))
        return false;
    return Object.values(catalog).some((provider) => isRecord(provider) &&
        isRecord(provider.models) &&
        Object.keys(provider.models).length > 0);
}
function modelsDevBoolean(selected, key) {
    return optionalBoolean(selected?.record[key]) !== undefined;
}
function modelsDevNumber(selected, objectKey, key) {
    const object = selected?.record[objectKey];
    return isRecord(object) ? optionalNumber(object[key]) : undefined;
}
function modelsDevObjectNumber(selected, objectKey, key) {
    return modelsDevNumber(selected, objectKey, key) !== undefined;
}
function anyDeploymentBoolean(group, key) {
    return group.deployments.some((deployment) => optionalBoolean(deployment.modelInfo[key]) !== undefined);
}
function anyDeploymentPositiveInteger(group, keys) {
    return group.deployments.some((deployment) => keys.some((key) => positiveInteger(deployment.modelInfo[key]) !== undefined));
}
function anyDeploymentNonNegativeNumber(group, keys) {
    return group.deployments.some((deployment) => keys.some((key) => {
        const value = optionalNumber(deployment.modelInfo[key]);
        return value !== undefined && value >= 0;
    }));
}
function anyModelsDevModalities(selected, direction) {
    const modalities = selected?.record.modalities;
    return isRecord(modalities) && Array.isArray(modalities[direction]) && modalities[direction].length > 0;
}
function capabilitySource(group, selected, kind) {
    if (kind === "tools") {
        if (anyDeploymentBoolean(group, "supports_function_calling"))
            return field("litellm");
        if (modelsDevBoolean(selected, "tool_call"))
            return field("models.dev");
        return field("default", "tools defaults to enabled when neither source declares support");
    }
    const fields = kind === "input"
        ? ["supports_vision", "supports_pdf_input", "supports_audio_input", "supports_video_input"]
        : ["supports_audio_output"];
    if (fields.some((key) => anyDeploymentBoolean(group, key)))
        return field("litellm");
    if (anyModelsDevModalities(selected, kind))
        return field("models.dev");
    return field("default", "text-only baseline");
}
function firstTierPoint(deployment) {
    const points = [];
    for (const [key, raw] of Object.entries(deployment.modelInfo)) {
        const match = /^input_cost_per_token_above_(\d+)k_tokens$/.exec(key);
        const value = optionalNumber(raw);
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
function contextProvenance(group, selected, options, spec) {
    const liteLLMDeclared = anyDeploymentPositiveInteger(group, ["max_input_tokens"]);
    const modelsDevDeclared = modelsDevObjectNumber(selected, "limit", "context");
    const tierPoints = group.deployments
        .map(firstTierPoint)
        .filter((value) => value !== undefined);
    const firstTier = tierPoints.length > 0 ? Math.min(...tierPoints) : undefined;
    if (options.contextTierCap && firstTier !== undefined && spec.limit.context === firstTier) {
        return field("derived", `LiteLLM pricing tier cap at ${firstTier} tokens`);
    }
    if (modelsDevDeclared)
        return field("models.dev", "limit.context");
    if (liteLLMDeclared)
        return field("litellm", "max_input_tokens used as conservative context fallback");
    return field("default", "no context limit metadata");
}
function outputLimitProvenance(group, selected) {
    if (anyDeploymentPositiveInteger(group, ["max_output_tokens", "max_tokens"]))
        return field("litellm");
    if (modelsDevObjectNumber(selected, "limit", "output"))
        return field("models.dev");
    return field("default", "no output limit metadata");
}
function pricingProvenance(group, selected, deploymentFields, modelsDevKey) {
    if (anyDeploymentNonNegativeNumber(group, deploymentFields))
        return field("litellm");
    if (modelsDevObjectNumber(selected, "cost", modelsDevKey)) {
        if (canUseSelectedModelsDevPrice(selected))
            return field("models.dev");
        return field("default", `models.dev ${selected?.selectionSource ?? "fallback"} price ignored; capability fallback is not deployment pricing`);
    }
    return field("default", "missing price metadata maps to zero");
}
function metadataConflicts(group, selected, reasoning) {
    const conflicts = [];
    const mdTools = optionalBoolean(selected?.record.tool_call);
    if (mdTools !== undefined &&
        group.deployments.some((deployment) => {
            const value = optionalBoolean(deployment.modelInfo.supports_function_calling);
            return value !== undefined && value !== mdTools;
        })) {
        conflicts.push({
            field: "capabilities.tools",
            resolution: "explicit LiteLLM values win per deployment; the group uses the conservative intersection",
        });
    }
    if (reasoning.conflict) {
        conflicts.push({
            field: "reasoning",
            resolution: "explicit LiteLLM supports_reasoning wins per deployment before models.dev fallback",
        });
    }
    const limitChecks = [
        ["limit.input", ["max_input_tokens"], "input"],
        ["limit.output", ["max_output_tokens", "max_tokens"], "output"],
    ];
    for (const [fieldName, liteLLMFields, modelsDevKey] of limitChecks) {
        const md = modelsDevNumber(selected, "limit", modelsDevKey);
        if (md === undefined)
            continue;
        const differs = group.deployments.some((deployment) => liteLLMFields.some((key) => {
            const value = positiveInteger(deployment.modelInfo[key]);
            return value !== undefined && value !== md;
        }));
        if (differs) {
            conflicts.push({
                field: fieldName,
                resolution: "explicit LiteLLM deployment limit wins; models.dev is used only when LiteLLM omits the field",
            });
        }
    }
    const priceChecks = [
        ["pricing.input", ["input_cost_per_token"], "input"],
        ["pricing.output", ["output_cost_per_token"], "output"],
        ["pricing.cacheRead", ["cache_read_input_token_cost", "cache_read_cost_per_token"], "cache_read"],
        ["pricing.cacheWrite", ["cache_creation_input_token_cost", "cache_write_input_token_cost"], "cache_write"],
    ];
    for (const [fieldName, liteLLMFields, modelsDevKey] of priceChecks) {
        const md = modelsDevNumber(selected, "cost", modelsDevKey);
        if (md === undefined)
            continue;
        const differs = group.deployments.some((deployment) => liteLLMFields.some((key) => {
            const value = optionalNumber(deployment.modelInfo[key]);
            return value !== undefined && value >= 0 && value * 1_000_000 !== md;
        }));
        if (differs) {
            conflicts.push({
                field: fieldName,
                resolution: "LiteLLM deployment pricing wins; multiple deployments use the highest declared price",
            });
        }
    }
    return conflicts;
}
function releaseProvenance(selected) {
    const value = selected?.record.release_date;
    if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) {
        return field("models.dev");
    }
    return field("none");
}
function protocolProvenance(reason) {
    switch (reason) {
        case "override":
            return field("override", "protocolOverrides");
        case "anthropic":
            return field("litellm", "Anthropic provider or Claude-family evidence");
        case "supported-endpoints":
            return field("litellm", "supported_endpoints");
        case "mode":
            return field("litellm", "mode");
        case "mixed-fallback":
            return field("derived", "deployment protocols disagree; conservative chat fallback");
        case "fallback":
            return field("default", "no stronger protocol evidence; chat fallback");
    }
}
function modelDiagnostic(group, spec, catalog, options) {
    const selected = selectModelsDevRecord(group, catalog);
    const protocol = resolveProtocolResolution(group, options.protocolOverrides);
    const variants = buildVariants(selected, spec.protocol);
    const reasoning = resolveReasoningSupport(group, selected);
    const conflicts = metadataConflicts(group, selected, reasoning);
    const issues = [];
    if (!selected) {
        issues.push({
            severity: "warning",
            stage: "models-dev",
            code: "models-dev-unmatched",
            modelId: group.modelName,
            message: "No models.dev record matched this LiteLLM model.",
        });
    }
    if (!hasOperationalLimits(spec)) {
        issues.push({
            severity: "warning",
            stage: "mapping",
            code: "model-operational-limits-missing",
            modelId: group.modelName,
            message: "Model context/output limits are not positive; host adapters must not publish this model as operational.",
        });
    }
    for (const conflict of conflicts) {
        issues.push({
            severity: "info",
            stage: "mapping",
            code: "metadata-conflict",
            modelId: group.modelName,
            message: `${conflict.field}: ${conflict.resolution}`,
        });
    }
    if (protocol.reason === "mixed-fallback") {
        issues.push({
            severity: "warning",
            stage: "protocol",
            code: "protocol-mixed-fallback",
            modelId: group.modelName,
            message: "Deployments disagree on protocol; chat fallback is used.",
        });
    }
    else if (protocol.reason === "fallback") {
        issues.push({
            severity: "info",
            stage: "protocol",
            code: "protocol-default-fallback",
            modelId: group.modelName,
            message: "No explicit protocol evidence was found; chat fallback is used.",
        });
    }
    return {
        diagnostic: {
            id: group.modelName,
            deploymentCount: group.deployments.length,
            candidates: candidateModelIDs(group),
            modelsDev: selected
                ? { matched: true, providerID: selected.providerID, modelID: selected.modelID }
                : { matched: false },
            protocol: {
                value: spec.protocol,
                reason: protocol.reason,
                support: resolveProtocolSupport(group),
                deploymentProtocols: protocol.deployments.map((item) => item.protocol),
            },
            quality: {
                identity: {
                    canonicalCandidates: [...new Set(candidateModelIDs(group).map(canonicalModelID))],
                    matchKind: selected?.matchKind,
                    matchedCandidate: selected?.matchedCandidate,
                },
                reasoning,
                protocolSupport: resolveProtocolSupport(group),
                fallback: selected ? "enriched" : "litellm-only",
                conflicts,
            },
            provenance: {
                protocol: protocolProvenance(protocol.reason),
                reasoning: variants.length > 0
                    ? field("models.dev", "reasoning_options")
                    : reasoning.source === "litellm"
                        ? field("litellm", "supports_reasoning")
                        : reasoning.source === "models.dev"
                            ? field("models.dev", "reasoning")
                            : reasoning.source === "derived"
                                ? field("derived", "LiteLLM and models.dev reasoning evidence")
                                : field("none", "no reasoning support metadata"),
                capabilities: {
                    tools: capabilitySource(group, selected, "tools"),
                    input: capabilitySource(group, selected, "input"),
                    output: capabilitySource(group, selected, "output"),
                },
                context: contextProvenance(group, selected, options, spec),
                outputLimit: outputLimitProvenance(group, selected),
                pricing: {
                    input: pricingProvenance(group, selected, ["input_cost_per_token"], "input"),
                    output: pricingProvenance(group, selected, ["output_cost_per_token"], "output"),
                    cacheRead: pricingProvenance(group, selected, ["cache_read_input_token_cost", "cache_read_cost_per_token"], "cache_read"),
                    cacheWrite: pricingProvenance(group, selected, ["cache_creation_input_token_cost", "cache_write_input_token_cost"], "cache_write"),
                },
                release: releaseProvenance(selected),
            },
        },
        issues,
    };
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
    const hasCatalog = catalogAvailable(modelsDevCatalog);
    if (!hasCatalog) {
        issues.push({
            severity: "warning",
            stage: "models-dev",
            code: "models-dev-degraded",
            message: "models.dev metadata is unavailable or empty; LiteLLM-only metadata is used.",
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
