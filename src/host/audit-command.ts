import type { Plugin } from "@opencode/plugin"
import { createAuditReport } from "./audit.js"
import { writeAuditFile } from "./audit-file.js"
import { auditRpc } from "./audit-rpc.js"
import {
  createFeedbackSubmitter,
  type AuditExportOutcome,
  type FeedbackSubmitter,
} from "./audit-feedback.js"
import type { ProviderSnapshot, Registration } from "./register.js"

export interface AuditDependencies {
  writeFile?: typeof writeAuditFile
  now?: () => Date
  /** 对话反馈开关；默认关闭。关闭时不得调用会话输入 API。 */
  conversationFeedback?: boolean
  /** 便于测试注入的反馈提交器工厂。 */
  createSubmitter?: (session: Pick<Plugin.Context["session"], "prompt">) => FeedbackSubmitter
}

function failureMessage(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : undefined
  if (code === "EACCES" || code === "EPERM") return "审查报告目录不可写"
  if (code === "ENOSPC") return "磁盘空间不足"
  if (code === "EEXIST") return "报告文件已存在，请重试"
  return "审查报告写入失败"
}

/**
 * 与报告文件同源的一次性快照元数据：在写文件之前捕获状态与模型数，
 * 避免写入期间连接状态变化导致消息与文件内容不一致。
 */
function captureSnapshot(audit: ProviderSnapshot["audit"]): { status: NonNullable<ProviderSnapshot["audit"]>["status"]; modelCount: number } {
  const source = audit ?? { status: "disconnected" as const }
  return { status: source.status, modelCount: source.view?.models.length ?? 0 }
}

export async function registerAudit(
  context: Pick<Plugin.Context, "rpc" | "command" | "session">,
  snapshot: ProviderSnapshot,
  dependencies: AuditDependencies = {},
): Promise<Registration> {
  let sequence = 0
  let latest = { sequence, sessionID: "", ok: false, path: "", error: "" }
  const writeFile = dependencies.writeFile ?? writeAuditFile
  const conversationFeedback = dependencies.conversationFeedback ?? false
  const createSubmitter = dependencies.createSubmitter
    ?? ((session: Pick<Plugin.Context["session"], "prompt">) => createFeedbackSubmitter(session))
  let rpc: Awaited<ReturnType<typeof context.rpc.register<typeof auditRpc>>>

  /** 导出一次，返回内部结果（含快照元数据），供命令路径生成反馈。 */
  const performExport = async (sessionID: string): Promise<AuditExportOutcome> => {
    const captured = captureSnapshot(snapshot.audit)
    try {
      const path = await writeFile(createAuditReport(
        snapshot.audit ?? { status: "disconnected" },
        dependencies.now?.() ?? new Date(),
      ))
      latest = { sequence: ++sequence, sessionID, ok: true, path, error: "" }
      await rpc.events.emit("completed", latest)
      return { ok: true, path, status: captured.status, modelCount: captured.modelCount }
    } catch (error) {
      const message = failureMessage(error)
      latest = { sequence: ++sequence, sessionID, ok: false, path: "", error: message }
      await rpc.events.emit("completed", latest)
      return { ok: false, error: message }
    }
  }

  const submitFeedback = async (sessionID: string, outcome: AuditExportOutcome): Promise<void> => {
    if (!conversationFeedback) return
    try {
      const submitter = createSubmitter(context.session)
      await submitter.submit(sessionID, outcome)
    } catch {
      // 反馈失败静默降级：报告与既有通道不受影响。
    }
  }

  rpc = await context.rpc.register(auditRpc, {
    async export(input) {
      const { sessionID } = input as { sessionID: string }
      const outcome = await performExport(sessionID)
      // RPC 路径不触发对话反馈：程序化调用不产生模型成本。
      return outcome.ok
        ? { sequence: latest.sequence, sessionID, ok: true, path: outcome.path, error: "" }
        : { sequence: latest.sequence, sessionID, ok: false, path: "", error: outcome.error }
    },
    async latest() {
      return latest
    },
  })
  try {
    const command = await context.command.transform((editor) => editor.add({
      name: "litellm-audit-export",
      description: "将当前 LiteLLM 模型注册视图导出到本地 JSON 文件",
      async execute({ sessionID }) {
        const outcome = await performExport(sessionID)
        await submitFeedback(sessionID, outcome)
      },
    }))
    return {
      async dispose() {
        await command.dispose()
        await rpc.dispose()
      },
    }
  } catch (error) {
    await rpc.dispose()
    throw error
  }
}
