import { createMultiEndpointAuditReport } from "./audit.js";
import { writeAuditFile } from "./audit-file.js";
import { auditRpc } from "./audit-rpc.js";
import { createDiagnosticsLines } from "./diagnostics.js";
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
        });
        return {
            async dispose() {
                await command.dispose();
                await rpc.dispose();
            },
        };
    }
    catch (error) {
        await rpc.dispose();
        throw error;
    }
}
