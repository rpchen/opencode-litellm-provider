/**
 * Adapter-side publication state for OpenCode.
 *
 * No business policy lives here: the Core partition decides what may
 * publish. This module only anchors per-endpoint controller memory
 * (LKG store, regression baseline, notification acknowledgement) to the
 * ProviderSnapshot object the discovery loop already mutates, so RPC
 * handlers and the loop share state without touching persisted shapes.
 *
 * Acknowledgement is reporting state only. There is no user confirmation
 * path into publication: a model Core withholds stays withheld.
 */
import { catalogFromPublication, createLastKnownGoodStore, } from "../generated/discovery-core/index.js";
export function createPublicationState() {
    return { store: createLastKnownGoodStore(), previouslyPublished: new Set() };
}
export function summarizePublication(publication, catalogFacts, failureKind) {
    const facts = (id, assessment) => [
        ...assessment.discrepancies.map((item) => ({
            model: id,
            field: item.field,
            status: item.status,
            resolution: item.resolution,
        })),
        ...assessment.conflicts.map((item) => ({
            model: id,
            field: item.field,
            status: item.status,
            resolution: item.resolution,
        })),
    ];
    const allFacts = [
        ...publication.publishable.flatMap((entry) => facts(entry.spec.id, entry.assessment)),
        ...publication.blocked.flatMap((entry) => facts(entry.spec.id, entry.assessment)),
    ];
    const lkgDetail = publication.publishable
        .map((entry) => entry.assessment.lkgDetail)
        .find((detail) => detail !== undefined);
    // Optional evidence fields are OMITTED when absent instead of being emitted
    // as explicit `undefined`: the OpenCode host validates plugin RPC outputs
    // against the declared schema, where an `undefined` property is not a
    // string. Both fields stay optional on the type.
    return {
        discovered: catalogFacts.discovered,
        publishable: publication.publishable.map((entry) => ({
            id: entry.spec.id,
            status: entry.assessment.status,
        })),
        lkgIDs: publication.publishable
            .filter((entry) => entry.assessment.usingLKG)
            .map((entry) => entry.spec.id),
        ...(lkgDetail === undefined ? {} : { lkgDetail }),
        withheld: catalogFacts.withheld.map((entry) => ({
            id: entry.id,
            status: entry.status,
            reasons: entry.reasons,
            previouslyPublished: entry.previouslyPublished,
            retryable: entry.retryability === "retryable",
        })),
        partial: catalogFacts.partial,
        unusable: catalogFacts.unusable,
        regressions: catalogFacts.regressions.map((entry) => entry.id),
        discrepancies: allFacts.filter((fact) => fact.status === "resolved-discrepancy"),
        conflicts: allFacts.filter((fact) => fact.status === "unresolved-conflict"),
        ...(failureKind === undefined ? {} : { failureKind }),
        acknowledgement: { notify: false, reason: "unchanged", fingerprint: catalogFacts.fingerprint },
    };
}
/** Core catalog facts for one publication partition (single source of truth). */
export function catalogFactsFor(publication, options = {}) {
    return catalogFromPublication(publication, options);
}
/**
 * User-facing notice for a materially new or regressed availability
 * problem. A first-time gap on a newly discovered model is intentionally
 * silent (diagnostics only); a regression or an unusable catalog is not.
 */
export function catalogNotice(summary) {
    if (!summary?.acknowledgement.notify)
        return undefined;
    switch (summary.acknowledgement.reason) {
        case "catalog-unusable":
            return {
                level: "warning",
                message: `endpoint 连接成功，发现 ${summary.discovered} 个模型，但当前没有任何模型可以安全发布。` +
                    (summary.regressions.length > 0 ? `此前可用的模型已被撤下：${summary.regressions.join("、")}。` : "") +
                    `请重新刷新（Retry）或运行 /litellm-diagnostics 查看每个模型的 withheld 原因。`,
            };
        case "regression":
            return {
                level: "warning",
                message: `此前可用的模型已被撤下：${summary.regressions.join("、")}。它们当前不可安全使用，` +
                    `插件不会自动切换到其他模型；请重新刷新（Retry）或改选其他模型。`,
            };
        case "new-issues":
            return {
                level: "info",
                message: `可用模型集合发生变化：${summary.withheld.length} 个模型 withheld。运行 /litellm-diagnostics 查看原因。`,
            };
        default:
            return undefined;
    }
}
/** Consume a pending catalog notice exactly once. */
export function takePendingNotice(snapshot) {
    const state = snapshot.publicationState;
    if (!state?.pendingNotice)
        return undefined;
    const notice = state.pendingNotice;
    state.pendingNotice = undefined;
    return notice;
}
