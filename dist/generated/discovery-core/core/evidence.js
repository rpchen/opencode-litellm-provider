/**
 * Evidence provenance, source authority, and discrepancy resolution.
 *
 * Single business source of truth for answering: given several sources
 * that describe the same fact, which one is allowed to decide, and is
 * the remaining difference a *resolved discrepancy* or a genuine
 * *unresolved conflict*?
 *
 * Two different kinds of fact are kept apart on purpose:
 *
 * - **Intrinsic model metadata** (context, output, modalities, tools,
 *   reasoning) describes the model itself. Once canonical identity is
 *   reliably resolved, the trusted models.dev record is the
 *   authoritative source. LiteLLM `model_info` values for the same
 *   dimension are *descriptive* secondary evidence: a difference is a
 *   recorded discrepancy, never an automatic conflict.
 * - **Deployment runtime constraints** are enforced by the endpoint
 *   itself. They may only narrow an effective value. They are proven
 *   from the operator's own deployment configuration (`litellm_params`),
 *   never inferred from a field name inside descriptive `model_info`.
 *
 * No I/O, no timers, no host SDK imports.
 */
import { isRecord, optionalBoolean, optionalNumber, } from "./litellm.js";
export function isResolvedDiscrepancy(resolution) {
    return resolution.status === "resolved-discrepancy";
}
export function isUnresolvedConflict(resolution) {
    return resolution.status === "unresolved-conflict";
}
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
/** Read a numeric field from `litellm_params` (deployment constraint) first, then `model_info`. */
export function deploymentNumericValue(deployment, descriptor) {
    for (const key of descriptor.constraintKeys) {
        const value = optionalNumber(deployment.litellmParams[key]);
        if (value !== undefined)
            return { value, origin: "deployment-constraint", key };
    }
    for (const key of descriptor.descriptiveKeys) {
        const value = optionalNumber(deployment.modelInfo[key]);
        if (value !== undefined)
            return { value, origin: "descriptive-metadata", key };
    }
    return undefined;
}
/** Every explicitly declared deployment-level value with its provenance. */
export function deploymentNumericEvidence(group, descriptor) {
    const evidence = [];
    for (const deployment of group.deployments) {
        for (const key of descriptor.constraintKeys) {
            const value = optionalNumber(deployment.litellmParams[key]);
            if (value !== undefined) {
                evidence.push({ source: "litellm", origin: "deployment-constraint", value, detail: `litellm_params.${key}` });
                break;
            }
        }
        for (const key of descriptor.descriptiveKeys) {
            const value = optionalNumber(deployment.modelInfo[key]);
            if (value !== undefined) {
                evidence.push({ source: "litellm", origin: "descriptive-metadata", value, detail: `model_info.${key}` });
                break;
            }
        }
    }
    return evidence;
}
/** Narrowest proven deployment constraint for a limit dimension. */
export function deploymentConstraintValue(group, keys) {
    const values = group.deployments.flatMap((deployment) => keys.flatMap((key) => {
        const value = optionalNumber(deployment.litellmParams[key]);
        return value !== undefined && value > 0 ? [value] : [];
    }));
    return values.length > 0 ? Math.min(...values) : undefined;
}
export function modelsDevNumeric(selected, pointer) {
    if (!selected)
        return undefined;
    const limit = selected.record.limit;
    if (!isRecord(limit))
        return undefined;
    return optionalNumber(limit[pointer]);
}
function fieldValueSortKey(value) {
    return Array.isArray(value) ? [...value].sort().join(",") : String(value);
}
/**
 * Resolve one numeric limit dimension.
 *
 * Authority ladder:
 * 1. illegal declared values (any origin) block the field;
 * 2. same-origin declared deployment values that disagree are an
 *    unresolved conflict when no authoritative intrinsic value exists;
 * 3. a trusted intrinsic value decides, and any differing lower-authority
 *    value is retained as a resolved discrepancy;
 * 4. proven deployment constraints then narrow the effective value.
 */
export function resolveNumericField(input) {
    const descriptor = NUMERIC_FIELD_DESCRIPTORS[input.field];
    const evidence = deploymentNumericEvidence(input.group, descriptor);
    const intrinsic = input.intrinsic !== undefined && input.intrinsic > 0 ? input.intrinsic : undefined;
    const intrinsicOrigin = input.intrinsicAuthority === "fallback-serving"
        ? "fallback-serving"
        : "authoritative-intrinsic";
    const all = [...evidence];
    if (intrinsic !== undefined) {
        all.push({
            source: "models.dev",
            origin: intrinsicOrigin,
            value: intrinsic,
            detail: input.intrinsicDetail ?? descriptor.intrinsicPointer,
        });
    }
    const declared = evidence.filter((item) => typeof item.value === "number");
    const illegalEvidence = declared.filter((item) => !(item.value > 0));
    if (illegalEvidence.length > 0) {
        return {
            resolution: {
                field: descriptor.field,
                status: "illegal",
                selectedSource: "litellm",
                resolution: "declared non-positive limit is illegal metadata; it is never treated as missing or as a default",
                evidence: all,
            },
            value: undefined,
            known: false,
            missing: false,
            unknown: false,
            illegal: true,
            conflict: false,
            discrepancy: false,
        };
    }
    // Descriptive declarations and proven runtime constraints are separate
    // evidence classes and are judged separately:
    // - cross-deployment disagreement among descriptive declarations is a
    //   real group-level conflict (no authority can pick a route);
    // - a proven runtime constraint (`litellm_params`) narrows the effective
    //   value and never participates in same-level conflict judgment --
    //   including against a fallback-serving intrinsic value (finding 3).
    const descriptiveValues = input.group.deployments
        .map((deployment) => {
        for (const key of descriptor.descriptiveKeys) {
            const value = optionalNumber(deployment.modelInfo[key]);
            if (value !== undefined)
                return value;
        }
        return undefined;
    })
        .filter((value) => value !== undefined);
    const declaredValues = descriptiveValues;
    const partiallyDeclared = declaredValues.length > 0 && declaredValues.length < input.group.deployments.length;
    const disagreeing = new Set(declaredValues).size > 1;
    const constraints = input.group.deployments.flatMap((deployment) => descriptor.constraintKeys.flatMap((key) => {
        const value = optionalNumber(deployment.litellmParams[key]);
        return value !== undefined && value > 0 ? [value] : [];
    }));
    const constraint = constraints.length > 0 ? Math.min(...constraints) : undefined;
    const bounds = (input.bounds ?? []).filter((value) => value > 0);
    if (disagreeing) {
        return {
            resolution: {
                field: descriptor.field,
                status: "unresolved-conflict",
                selectedSource: "litellm",
                resolution: "deployments declare different values for the same host model; a model-level record cannot prove which route the host will use, so the field stays unresolved",
                evidence: all,
            },
            value: undefined,
            known: false,
            missing: false,
            unknown: false,
            illegal: false,
            conflict: true,
            discrepancy: false,
        };
    }
    if (intrinsic === undefined) {
        if (declaredValues.length === 0) {
            return {
                resolution: {
                    field: descriptor.field,
                    status: "missing",
                    selectedSource: "none",
                    resolution: "no source declares this limit",
                    evidence: all,
                },
                value: undefined,
                known: false,
                missing: true,
                unknown: false,
                illegal: false,
                conflict: false,
                discrepancy: false,
            };
        }
        if (disagreeing) {
            return {
                resolution: {
                    field: descriptor.field,
                    status: "unresolved-conflict",
                    selectedSource: "litellm",
                    resolution: "deployment declarations disagree and no authoritative intrinsic source resolves it",
                    evidence: all,
                },
                value: undefined,
                known: false,
                missing: false,
                unknown: false,
                illegal: false,
                conflict: true,
                discrepancy: false,
            };
        }
        if (partiallyDeclared) {
            return {
                resolution: {
                    field: descriptor.field,
                    status: "unknown",
                    selectedSource: "litellm",
                    resolution: "some deployments declare this limit and others do not; unknown is never coerced into a value",
                    evidence: all,
                },
                value: undefined,
                known: false,
                missing: false,
                unknown: true,
                illegal: false,
                conflict: false,
                discrepancy: false,
            };
        }
    }
    const isAuthoritative = intrinsicOrigin === "authoritative-intrinsic";
    // Same-level descriptive evidence that contradicts a fallback-serving
    // value cannot be decided by authority: that stays an unresolved conflict,
    // and the field never reaches the host as the reseller's serving number.
    // Proven runtime constraints are NOT part of this judgment -- they narrow
    // instead (see the per-class split above).
    const sameLevelConflict = !isAuthoritative &&
        intrinsic !== undefined &&
        declaredValues.some((value) => value !== intrinsic);
    // Proven constraints that disagree with EACH OTHER are a genuine
    // deployment conflict (no route provability); a single consistent
    // constraint only narrows and is never a discrepancy (review finding 3).
    const crossDeploymentConstraintConflict = constraints.length > 1 && new Set(constraints).size > 1;
    if (crossDeploymentConstraintConflict) {
        return {
            resolution: {
                field: descriptor.field,
                status: "unresolved-conflict",
                selectedSource: "litellm",
                resolution: "deployments enforce different runtime constraints for the same host model; a model-level record cannot prove which route the host will use, so the field stays unresolved",
                evidence: all,
            },
            value: undefined,
            known: false,
            missing: false,
            unknown: false,
            illegal: false,
            conflict: true,
            discrepancy: false,
        };
    }
    const lowerAuthorityDiffer = isAuthoritative &&
        all.some((item) => item.origin === "descriptive-metadata" &&
            typeof item.value === "number" &&
            intrinsic !== undefined &&
            item.value !== intrinsic);
    const base = intrinsic ?? (declaredValues.length > 0 ? Math.min(...declaredValues) : undefined);
    const narrowed = base === undefined || sameLevelConflict
        ? undefined
        : Math.min(base, ...(constraint !== undefined ? [constraint] : []), ...bounds);
    const effective = narrowed !== undefined && narrowed > 0 ? narrowed : undefined;
    const constraintNarrowed = constraint !== undefined && base !== undefined && constraint < base;
    const resolution = sameLevelConflict
        ? {
            field: descriptor.field,
            status: "unresolved-conflict",
            selectedSource: "litellm",
            resolution: "fallback serving metadata and LiteLLM descriptive declarations disagree at the same authority level; no authority can decide",
            evidence: all,
        }
        : {
            field: descriptor.field,
            status: lowerAuthorityDiffer ? "resolved-discrepancy" : "selected",
            value: effective,
            selectedSource: intrinsic !== undefined ? "models.dev" : "litellm",
            resolution: intrinsic !== undefined
                ? lowerAuthorityDiffer
                    ? "authoritative intrinsic metadata decides; lower-authority LiteLLM declarations are retained as a resolved discrepancy"
                    : constraintNarrowed
                        ? isAuthoritative
                            ? "authoritative intrinsic metadata narrowed by a proven endpoint runtime constraint"
                            : "fallback serving metadata narrowed by a proven endpoint runtime constraint"
                        : isAuthoritative
                            ? "authoritative intrinsic metadata decides"
                            : "fallback serving metadata fills the gap; LiteLLM declares nothing for this dimension"
                : constraintNarrowed
                    ? "no authoritative intrinsic source; the declared value narrowed by a proven endpoint runtime constraint"
                    : "no authoritative intrinsic source; the declared deployment value decides",
            evidence: all.sort((left, right) => fieldValueSortKey(left.value).localeCompare(fieldValueSortKey(right.value), "en")),
        };
    return {
        resolution,
        value: effective,
        known: effective !== undefined,
        missing: false,
        unknown: false,
        illegal: false,
        conflict: sameLevelConflict,
        discrepancy: lowerAuthorityDiffer,
    };
}
/**
 * Resolve one boolean capability dimension.
 *
 * A trusted intrinsic verdict decides; contradicting LiteLLM declarations
 * become a resolved discrepancy. Without an intrinsic verdict the legacy
 * tri-state rules apply unchanged (missing evidence stays unknown,
 * same-level disagreement stays an unresolved conflict).
 */
export function resolveBooleanField(input) {
    const evidence = [];
    for (const deployment of input.group.deployments) {
        if (input.constraintKey) {
            const constrained = optionalBoolean(deployment.litellmParams[input.constraintKey]);
            if (constrained !== undefined) {
                evidence.push({
                    source: "litellm",
                    origin: "deployment-constraint",
                    value: constrained,
                    detail: `litellm_params.${input.constraintKey}`,
                });
                continue;
            }
        }
        const declared = optionalBoolean(deployment.modelInfo[input.descriptiveKey]);
        if (declared !== undefined) {
            evidence.push({
                source: "litellm",
                origin: "descriptive-metadata",
                value: declared,
                detail: `model_info.${input.descriptiveKey}`,
            });
        }
    }
    if (input.intrinsic !== undefined) {
        evidence.push({
            source: "models.dev",
            origin: input.intrinsicAuthority === "fallback-serving" ? "fallback-serving" : "authoritative-intrinsic",
            value: input.intrinsic,
            detail: input.intrinsicDetail ?? input.field,
        });
    }
    if (input.intrinsic !== undefined) {
        // Two deployments of the same host model that explicitly disagree are a
        // genuine deployment-level conflict: a model-level record cannot prove
        // which route the host will use, so the dimension stays unresolved.
        const isAuthoritative = input.intrinsicAuthority !== "fallback-serving";
        // Deployment-level evidence only: descriptive declarations are the
        // same-level class for a fallback-serving verdict, so a plain
        // disagreement with the serving verdict stays unresolved. Runtime
        // constraints are a separate class -- they narrow the verdict below and
        // never participate in conflict judgment (review finding 3). Never
        // include the intrinsic verdict itself in this disagreement check.
        const descriptive = evidence
            .filter((item) => item.origin === "descriptive-metadata")
            .map((item) => item.value);
        const deploymentDisagreement = descriptive.some((value) => value === true) && descriptive.some((value) => value === false)
            || (!isAuthoritative && descriptive.includes(!input.intrinsic));
        if (deploymentDisagreement) {
            return {
                resolution: {
                    field: input.field,
                    status: "unresolved-conflict",
                    value: undefined,
                    selectedSource: "litellm",
                    resolution: !isAuthoritative
                        ? "fallback serving metadata and LiteLLM descriptive declarations disagree at the same authority level; no authority can decide"
                        : "deployments explicitly disagree about this capability; unresolved until the endpoint is made consistent",
                    evidence,
                },
                state: "unknown",
                conflict: true,
                discrepancy: false,
            };
        }
        // An explicit deployment constraint (`false`) narrows a supported verdict
        // for authoritative AND fallback-serving intrinsic values alike: a proven
        // `litellm_params` constraint is what the endpoint enforces.
        const constraints = evidence.filter((item) => item.origin === "deployment-constraint");
        const narrowed = constraints.some((item) => item.value === false);
        const state = input.intrinsic && !narrowed ? "supported" : "unsupported";
        const discrepancy = isAuthoritative &&
            evidence.some((item) => item.origin !== "authoritative-intrinsic" && item.value !== (state === "supported"));
        return {
            resolution: {
                field: input.field,
                status: discrepancy ? "resolved-discrepancy" : "selected",
                value: state === "supported",
                selectedSource: "models.dev",
                resolution: !isAuthoritative
                    ? narrowed
                        ? "fallback serving metadata narrowed by a proven endpoint runtime constraint"
                        : descriptive.some((value) => value !== undefined)
                            ? "fallback serving metadata fills the gap; LiteLLM descriptive declarations agree"
                            : "fallback serving metadata fills the gap; LiteLLM declares nothing for this dimension"
                    : discrepancy
                        ? "authoritative intrinsic metadata decides; lower-authority LiteLLM declarations are retained as a resolved discrepancy"
                        : "authoritative intrinsic metadata decides",
                evidence,
            },
            state,
            conflict: false,
            discrepancy,
        };
    }
    return {
        resolution: {
            field: input.field,
            status: input.fallbackState === "unknown"
                ? input.fallbackConflict ? "unresolved-conflict" : "unknown"
                : "selected",
            value: input.fallbackState === "unknown" ? undefined : input.fallbackState === "supported",
            selectedSource: input.fallbackState === "unknown" ? "none" : "litellm",
            resolution: input.fallbackState === "unknown"
                ? input.fallbackConflict
                    ? "declarations disagree and no authoritative source resolves the disagreement"
                    : "no trusted declaration exists for this dimension; unknown is never coerced"
                : "explicit deployment declarations agree",
            evidence,
        },
        state: input.fallbackState,
        conflict: input.fallbackConflict,
        discrepancy: false,
    };
}
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
function orderedModalitySet(values, dimensions) {
    const set = new Set(values);
    if (!set.has("text"))
        set.add("text");
    const ordered = ["text"];
    for (const dimension of dimensions) {
        if (set.has(dimension.modality))
            ordered.push(dimension.modality);
    }
    for (const value of set) {
        if (!ordered.includes(value))
            ordered.push(value);
    }
    return ordered;
}
/**
 * Resolve one modality direction.
 *
 * With a trusted intrinsic list the direction is known and the intrinsic
 * set decides; contradicting LiteLLM flags are a resolved discrepancy. A
 * proven deployment constraint (`litellm_params` flag explicitly `false`)
 * removes a modality from the effective set. Without authority the legacy
 * sparse-flag rules apply: only a documented complete set makes the
 * direction known.
 */
export function resolveModalityField(input) {
    const dimensions = modalityDimensions(input.direction);
    const evidence = [];
    for (const deployment of input.group.deployments) {
        for (const dimension of dimensions) {
            const constrained = optionalBoolean(deployment.litellmParams[dimension.key]);
            if (constrained !== undefined) {
                evidence.push({
                    source: "litellm",
                    origin: "deployment-constraint",
                    value: constrained,
                    detail: `litellm_params.${dimension.key} (${dimension.modality})`,
                });
                continue;
            }
            const declared = optionalBoolean(deployment.modelInfo[dimension.key]);
            if (declared !== undefined) {
                evidence.push({
                    source: "litellm",
                    origin: "descriptive-metadata",
                    value: declared,
                    detail: `model_info.${dimension.key} (${dimension.modality})`,
                });
            }
        }
    }
    if (input.intrinsic !== undefined) {
        evidence.push({
            source: "models.dev",
            origin: input.intrinsicAuthority === "fallback-serving" ? "fallback-serving" : "authoritative-intrinsic",
            value: input.intrinsic,
            detail: input.intrinsicDetail ?? `modalities.${input.direction}`,
        });
    }
    if (input.intrinsic !== undefined) {
        const intrinsicSet = new Set(input.intrinsic);
        const isAuthoritative = input.intrinsicAuthority !== "fallback-serving";
        const removed = new Set();
        for (const dimension of dimensions) {
            // Descriptive declarations only: runtime constraints are a separate
            // evidence class that narrows below and never joins this same-level
            // conflict judgment (review finding 3).
            const declared = evidence
                .filter((item) => item.detail?.includes(`(${dimension.modality})`) &&
                item.origin === "descriptive-metadata")
                .map((item) => item.value);
            // Explicit deployment-level disagreement (one says supported, another
            // says not) is a genuine conflict a model-level record cannot decide.
            // Without intrinsic authority a descriptive flag that contradicts the
            // serving metadata is equally undecidable.
            const deploymentDisagreement = declared.some((value) => value === true) && declared.some((value) => value === false)
                || (!isAuthoritative && declared.some((value) => value !== undefined && value !== intrinsicSet.has(dimension.modality)));
            if (deploymentDisagreement) {
                return {
                    resolution: {
                        field: `capabilities.${input.direction}`,
                        status: "unresolved-conflict",
                        value: undefined,
                        selectedSource: "litellm",
                        resolution: !isAuthoritative && !(declared.some((value) => value === true) && declared.some((value) => value === false))
                            ? "fallback serving metadata and LiteLLM descriptive declarations disagree at the same authority level; no authority can decide"
                            : "deployments explicitly disagree about a modality; unresolved until the endpoint is made consistent",
                        evidence,
                    },
                    values: [],
                    known: false,
                    discrepancy: false,
                    conflict: true,
                };
            }
            if (!intrinsicSet.has(dimension.modality))
                continue;
            const constrained = evidence.some((item) => item.origin === "deployment-constraint" &&
                item.detail?.includes(`(${dimension.modality})`) &&
                item.value === false);
            if (constrained)
                removed.add(dimension.modality);
        }
        const selected = new Set(["text", ...dimensions
                .map((dimension) => dimension.modality)
                .filter((modality) => intrinsicSet.has(modality) && !removed.has(modality))]);
        const selectedValues = orderedModalitySet(selected, dimensions);
        const discrepancy = isAuthoritative &&
            evidence.some((item) => {
                if (item.origin === "authoritative-intrinsic")
                    return false;
                const modality = dimensions.find((dimension) => item.detail?.includes(`(${dimension.modality})`))?.modality;
                if (!modality)
                    return false;
                const expected = selected.has(modality);
                // `false` matching an absent (or constraint-removed) modality is a
                // consistent fact, not a discrepancy.
                if (item.value === false && !expected)
                    return false;
                return item.value !== expected;
            });
        const constraintRemoved = removed.size > 0;
        return {
            resolution: {
                field: `capabilities.${input.direction}`,
                status: discrepancy ? "resolved-discrepancy" : "selected",
                value: selectedValues,
                selectedSource: "models.dev",
                resolution: discrepancy
                    ? "authoritative intrinsic modalities decide; lower-authority LiteLLM flags are retained as a resolved discrepancy"
                    : !isAuthoritative
                        ? constraintRemoved
                            ? "fallback serving modality metadata narrowed by a proven endpoint runtime constraint"
                            : "fallback serving modality metadata fills gaps but never outranks LiteLLM declarations"
                        : isAuthoritative
                            ? "authoritative intrinsic modalities decide"
                            : "fallback serving modality metadata fills gaps but never outranks LiteLLM declarations",
                evidence,
            },
            values: selectedValues,
            known: true,
            discrepancy,
            conflict: false,
        };
    }
    // No authority: legacy sparse-flag semantics are unchanged.
    let conflict = false;
    const supported = new Set();
    for (const dimension of dimensions) {
        const declared = evidence
            .filter((item) => item.detail?.includes(`(${dimension.modality})`))
            .map((item) => item.value);
        const defined = declared.filter((value) => typeof value === "boolean");
        if (defined.length === 0)
            continue;
        if (!defined.every((value) => value === defined[0])) {
            conflict = true;
            continue;
        }
        if (defined[0] === true)
            supported.add(dimension.modality);
    }
    const everyDimensionDeclared = dimensions.every((dimension) => {
        const declared = evidence.filter((item) => item.detail?.includes(`(${dimension.modality})`));
        return declared.length === input.group.deployments.length && declared.length > 0;
    });
    const known = !conflict && everyDimensionDeclared;
    return {
        resolution: {
            field: `capabilities.${input.direction}`,
            status: conflict ? "unresolved-conflict" : known ? "selected" : "unknown",
            value: known ? orderedModalitySet(supported, dimensions) : undefined,
            selectedSource: known ? "litellm" : "none",
            resolution: conflict
                ? "declarations disagree and no authoritative source resolves the disagreement"
                : known
                    ? "every dimension of this direction is explicitly declared and agrees"
                    : "LiteLLM modality flags are sparse; a partially declared direction stays unknown",
            evidence,
        },
        values: known ? orderedModalitySet(supported, dimensions) : [],
        known,
        discrepancy: false,
        conflict,
    };
}
/** Recorded value differences that authority already resolved. */
export function materialDiscrepancies(resolutions) {
    return resolutions.filter(isResolvedDiscrepancy);
}
/** Genuine conflicts that block publication. */
export function materialConflicts(resolutions) {
    return resolutions.filter(isUnresolvedConflict);
}
