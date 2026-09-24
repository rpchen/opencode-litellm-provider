import type { Plugin } from "@opencode/plugin"
import { createAuditReport } from "./audit.js"
import { writeAuditFile } from "./audit-file.js"
import { auditRpc } from "./audit-rpc.js"
import type { ProviderSnapshot, Registration } from "./register.js"

export interface AuditDependencies {
  writeFile?: typeof writeAuditFile
  now?: () => Date
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

export async function registerAudit(
  context: Pick<Plugin.Context, "rpc" | "command">,
  snapshot: ProviderSnapshot,
  dependencies: AuditDependencies = {},
): Promise<Registration> {
  let sequence = 0
  let latest = { sequence, sessionID: "", ok: false, path: "", error: "" }
  const writeFile = dependencies.writeFile ?? writeAuditFile
  let rpc: Awaited<ReturnType<typeof context.rpc.register<typeof auditRpc>>>
  const performExport = async (sessionID: string) => {
    try {
      const path = await writeFile(createAuditReport(
        snapshot.audit ?? { status: "disconnected" },
        dependencies.now?.() ?? new Date(),
      ))
      latest = { sequence: ++sequence, sessionID, ok: true, path, error: "" }
    } catch (error) {
      latest = { sequence: ++sequence, sessionID, ok: false, path: "", error: failureMessage(error) }
    }
    await rpc.events.emit("completed", latest)
    return latest
  }
  rpc = await context.rpc.register(auditRpc, {
    async export(input) {
      const { sessionID } = input as { sessionID: string }
      return performExport(sessionID)
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
        await performExport(sessionID)
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
