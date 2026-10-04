import { createMultiEndpointAuditReport } from "./audit.js";
import { writeAuditFile } from "./audit-file.js";
import { auditRpc } from "./audit-rpc.js";
import { createDiagnosticsLines } from "./diagnostics.js";
import { acceptDegradedForSnapshot, splitAcceptArgs, } from "./publication.js";
import { publicationRpc } from "./publication-rpc.js";
function failureMessage(error) {
    const code = typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    if (code === "EACCES" || code === "EPERM")
        return "审查报告目录不可写";
    if (code === "ENOSPC")
        return "磁盘空间不足";
    if (code === "EEXIST")
        return "报告文件已存在，请重试";
    return "审查报告写入失败";
}
function requestedEndpoint(input) {
    if (typeof input !== "object" || input === null)
        return "";
    const record = input;
    const prompt = record.prompt;
    if (typeof prompt === "object" && prompt !== null) {
        const text = prompt.text;
        if (typeof text === "string")
            return text.trim();
    }
    for (const key of ["args", "arguments", "argument"]) {
        if (typeof record[key] === "string")
            return record[key].trim();
    }
    return "";
}
export async function registerMultiEndpointAudit(context, endpointIds, activeEndpointIds, snapshots, dependencies = {}) {
    const writeFile = dependencies.writeFile ?? writeAuditFile;
    let sequence = 0;
    let diagnosticSequence = 0;
    let latest = { sequence, sessionID: "", ok: false, path: "", error: "" };
    let rpc;
    const performExport = async (sessionID) => {
        const active = new Set(activeEndpointIds());
        const entries = endpointIds
            .filter((id) => active.has(id))
            .map((id) => ({
            id,
            snapshot: snapshots.get(id)?.audit ?? { status: "disconnected" },
        }));
        try {
            const path = await writeFile(createMultiEndpointAuditReport(entries, dependencies.now?.() ?? new Date()));
            latest = { sequence: ++sequence, sessionID, ok: true, path, error: "" };
            await rpc.events.emit("completed", latest);
            return latest;
        }
        catch (error) {
            latest = { sequence: ++sequence, sessionID, ok: false, path: "", error: failureMessage(error) };
            await rpc.events.emit("completed", latest);
            return latest;
        }
    };
    rpc = await context.rpc.register(auditRpc, {
        async export(input) {
            return performExport(input.sessionID);
        },
        async latest() {
            return latest;
        },
    });
    const publication = await context.rpc.register(publicationRpc, {
        async state(input) {
            const { endpointId } = input;
            const candidates = endpointId ? [snapshots.get(endpointId)] : [...snapshots.values()];
            const found = candidates.find((snapshot) => snapshot?.diagnostics?.publication !== undefined);
            return found?.diagnostics?.publication ?? { publishable: [], degradedIDs: [], lkgIDs: [], blocked: [] };
        },
        async accept(input) {
            const { sessionID, modelId, endpointId } = input;
            const target = endpointId
                ? snapshots.get(endpointId)
                : [...snapshots.values()].find((snapshot) => snapshot.diagnostics?.publication?.blocked.some((model) => model.id === modelId));
            if (!target) {
                return { ok: false, status: "", gaps: [], reason: endpointId ? "unknown-endpoint" : "unknown-model" };
            }
            const outcome = acceptDegradedForSnapshot(target, modelId);
            await publication.events.emit("accepted", {
                sessionID,
                modelId,
                ok: outcome.accepted,
                status: outcome.status ?? "",
                gaps: [...(outcome.gaps ?? [])],
                reason: outcome.reason ?? (outcome.accepted ? "degraded-accepted" : "rejected"),
            });
            return {
                ok: outcome.accepted,
                status: outcome.status ?? "",
                gaps: [...(outcome.gaps ?? [])],
                reason: outcome.reason ?? (outcome.accepted ? "degraded-accepted" : "rejected"),
            };
        },
    });
    try {
        const command = await context.command.transform((editor) => {
            editor.add({
                name: "litellm-diagnostics",
                description: "显示 LiteLLM endpoint 总览；传 endpoint id 查看详情",
                async execute(input) {
                    const record = input;
                    const requested = requestedEndpoint(input);
                    const active = new Set(activeEndpointIds());
                    let lines;
                    if (requested) {
                        if (!endpointIds.includes(requested)) {
                            lines = [`未知 LiteLLM endpoint：${requested}`];
                        }
                        else if (!active.has(requested)) {
                            lines = [
                                `Endpoint：${requested}`,
                                "状态：未激活",
                                "已注册模型：0",
                            ];
                        }
                        else {
                            const snapshot = snapshots.get(requested) ?? { ready: false, models: [], audit: { status: "pending" } };
                            lines = [`Endpoint：${requested}`, ...createDiagnosticsLines(snapshot)];
                        }
                    }
                    else {
                        lines = [
                            `LiteLLM Endpoints · active ${active.size}/${endpointIds.length}`,
                            ...endpointIds.map((id) => {
                                if (!active.has(id))
                                    return `○ ${id} · 未激活 · models=0`;
                                const snapshot = snapshots.get(id);
                                return `✓ ${id} · ${snapshot?.audit?.status ?? "pending"} · models=${snapshot?.audit?.view?.models.length ?? snapshot?.models.length ?? 0}`;
                            }),
                        ];
                    }
                    latest = {
                        sequence: ++diagnosticSequence,
                        sessionID: record.sessionID,
                        ok: true,
                        path: "",
                        error: "",
                        lines,
                    };
                    await rpc.events.emit("completed", latest);
                },
            });
            editor.add({
                name: "litellm-audit-export",
                description: "导出当前 active LiteLLM endpoints 的模型注册视图",
                async execute({ sessionID }) {
                    await performExport(sessionID);
                },
            });
            editor.add({
                name: "litellm-accept-degraded",
                description: "对指定 endpoint 的未完成模型显式接受降级配置",
                async execute(input) {
                    const record = input;
                    const parts = splitAcceptArgs(requestedEndpoint(input));
                    const endpointId = parts.length >= 2 ? parts[0] : undefined;
                    const modelId = parts.length >= 2 ? parts.slice(1).join(" ") : parts[0];
                    const target = endpointId ? snapshots.get(endpointId) : undefined;
                    let outcome;
                    if (parts.length < 2 || !target || !modelId) {
                        outcome = { accepted: false, reason: !target && parts.length >= 2 ? "unknown-endpoint" : "usage" };
                    }
                    else {
                        outcome = acceptDegradedForSnapshot(target, modelId);
                    }
                    await publication.events.emit("accepted", {
                        sessionID: record.sessionID,
                        modelId: modelId ?? "",
                        ok: outcome.accepted,
                        status: outcome.status ?? "",
                        gaps: [...(outcome.gaps ?? [])],
                        reason: outcome.reason ?? (outcome.accepted ? "degraded-accepted" : "rejected"),
                    });
                    latest = {
                        sequence: ++diagnosticSequence,
                        sessionID: record.sessionID,
                        ok: outcome.accepted,
                        path: "",
                        error: outcome.accepted ? "" : (outcome.reason ?? "rejected"),
                        lines: target ? createDiagnosticsLines(target) : ["unknown-endpoint"],
                    };
                    await rpc.events.emit("completed", latest);
                },
            });
        });
        return {
            async dispose() {
                await command.dispose();
                await publication.dispose();
                await rpc.dispose();
            },
        };
    }
    catch (error) {
        await publication.dispose();
        await rpc.dispose();
        throw error;
    }
}
