import { createAuditReport } from "./audit.js";
import { writeAuditFile } from "./audit-file.js";
import { auditRpc } from "./audit-rpc.js";
import { createDiagnosticsLines } from "./diagnostics.js";
import { applyErrorLabel, credentialLabel, statusLabel, userVisibleStatus, } from "./endpoint-state.js";
import { acceptDegradedForSnapshot, splitAcceptArgs, } from "./publication.js";
import { publicationRpc } from "./publication-rpc.js";
import { createFeedbackSubmitter, } from "./audit-feedback.js";
import { endpointStateOf } from "./register.js";
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
/**
 * 与报告文件同源的一次性快照元数据：在写文件之前捕获状态与模型数，
 * 避免写入期间连接状态变化导致消息与文件内容不一致。
 */
function captureSnapshot(audit) {
    const source = audit ?? { status: "disconnected" };
    return { status: source.status, modelCount: source.view?.models.length ?? 0 };
}
export async function registerAudit(context, snapshot, dependencies = {}) {
    let sequence = 0;
    let diagnosticSequence = 0;
    let latest = { sequence, sessionID: "", ok: false, path: "", error: "" };
    const writeFile = dependencies.writeFile ?? writeAuditFile;
    const conversationFeedback = dependencies.conversationFeedback ?? false;
    const createSubmitter = dependencies.createSubmitter
        ?? ((session) => createFeedbackSubmitter(session));
    let rpc;
    /** 导出一次，返回内部结果（含快照元数据），供命令路径生成反馈。 */
    const performExport = async (sessionID) => {
        const captured = captureSnapshot(snapshot.audit);
        try {
            const path = await writeFile(createAuditReport(snapshot.audit ?? { status: "disconnected" }, dependencies.now?.() ?? new Date()));
            latest = { sequence: ++sequence, sessionID, ok: true, path, error: "" };
            await rpc.events.emit("completed", latest);
            return { ok: true, path, status: captured.status, modelCount: captured.modelCount };
        }
        catch (error) {
            const message = failureMessage(error);
            latest = { sequence: ++sequence, sessionID, ok: false, path: "", error: message };
            await rpc.events.emit("completed", latest);
            return { ok: false, error: message };
        }
    };
    const submitFeedback = async (sessionID, outcome) => {
        if (!conversationFeedback)
            return;
        try {
            const submitter = createSubmitter(context.session);
            await submitter.submit(sessionID, outcome);
        }
        catch {
            // 反馈失败静默降级：报告与既有通道不受影响。
        }
    };
    rpc = await context.rpc.register(auditRpc, {
        async export(input) {
            const { sessionID } = input;
            const outcome = await performExport(sessionID);
            // RPC 路径不触发对话反馈：程序化调用不产生模型成本。
            return outcome.ok
                ? { sequence: latest.sequence, sessionID, ok: true, path: outcome.path, error: "" }
                : { sequence: latest.sequence, sessionID, ok: false, path: "", error: outcome.error };
        },
        async latest() {
            return latest;
        },
    });
    const publication = await context.rpc.register(publicationRpc, {
        async state() {
            return snapshot.diagnostics?.publication ?? { publishable: [], degradedIDs: [], lkgIDs: [], blocked: [] };
        },
        async accept(input) {
            const { sessionID, modelId } = input;
            const outcome = acceptDegradedForSnapshot(snapshot, modelId);
            await publication.events.emit("accepted", {
                sessionID,
                modelId,
                ok: outcome.accepted,
                status: outcome.status ?? "",
                gaps: [...(outcome.gaps ?? [])],
                reason: outcome.reason ?? (outcome.accepted ? "degraded-accepted" : "rejected"),
            });
            latest = {
                sequence: ++diagnosticSequence,
                sessionID,
                ok: outcome.accepted,
                path: "",
                error: outcome.accepted ? "" : (outcome.reason ?? "rejected"),
                lines: createDiagnosticsLines(snapshot),
            };
            await rpc.events.emit("completed", latest);
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
                description: "显示 LiteLLM 发现、协议、元数据来源、缓存与构建诊断（含期望/配置/凭据/Runtime 状态）",
                async execute({ sessionID }) {
                    const state = endpointStateOf(snapshot, "default");
                    const appliedSummary = state.applied.kind === "active"
                        ? `已生效（${state.applied.modelCount} 个模型）`
                        : state.applied.kind === "not-applied"
                            ? "未生效"
                            : `出错（${applyErrorLabel(state.applied.category)}）`;
                    latest = {
                        sequence: ++diagnosticSequence,
                        sessionID,
                        ok: true,
                        path: "",
                        error: "",
                        lines: [
                            `Endpoint：default · 状态：${statusLabel(userVisibleStatus(state))} · 期望：${state.desired === "enabled" ? "已启用" : "未启用"} · 凭据：${credentialLabel(state.credential)} · Runtime：${appliedSummary}${state.validation.kind === "invalid" ? ` · 配置：非法（${state.validation.reason}）` : ""}`,
                            ...createDiagnosticsLines(snapshot),
                        ],
                    };
                    await rpc.events.emit("completed", latest);
                },
            });
            editor.add({
                name: "litellm-audit-export",
                description: "将当前 LiteLLM 模型注册视图导出到本地 JSON 文件",
                async execute({ sessionID }) {
                    const outcome = await performExport(sessionID);
                    await submitFeedback(sessionID, outcome);
                },
            });
            editor.add({
                name: "litellm-accept-degraded",
                description: "显式接受某个未完成模型的降级配置（仍标记为降级，下次刷新生效）",
                async execute(input) {
                    const record = input;
                    const [modelId] = splitAcceptArgs(readAcceptText(input)).slice(-1);
                    const outcome = modelId
                        ? acceptDegradedForSnapshot(snapshot, modelId)
                        : { accepted: false, reason: "usage" };
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
                        lines: createDiagnosticsLines(snapshot),
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
function readAcceptText(input) {
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
