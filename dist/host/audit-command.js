import { createAuditReport } from "./audit.js";
import { writeAuditFile } from "./audit-file.js";
import { auditRpc } from "./audit-rpc.js";
import { createFeedbackSubmitter, } from "./audit-feedback.js";
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
    try {
        const command = await context.command.transform((editor) => editor.add({
            name: "litellm-audit-export",
            description: "将当前 LiteLLM 模型注册视图导出到本地 JSON 文件",
            async execute({ sessionID }) {
                const outcome = await performExport(sessionID);
                await submitFeedback(sessionID, outcome);
            },
        }));
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
