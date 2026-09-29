import type { Plugin } from "@opencode/plugin"
import { createMultiEndpointAuditReport } from "./audit.js"
import { writeAuditFile } from "./audit-file.js"
import { auditRpc } from "./audit-rpc.js"
import { createDiagnosticsLines } from "./diagnostics.js"
import type { ProviderSnapshot, Registration } from "./register.js"

interface MultiAuditDependencies {
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

function requestedEndpoint(input: unknown): string {
  if (typeof input !== "object" || input === null) return ""
  const record = input as Record<string, unknown>
  for (const key of ["args", "arguments", "argument"] as const) {
    if (typeof record[key] === "string") return record[key].trim()
  }
  return ""
}

export async function registerMultiEndpointAudit(
  context: Pick<Plugin.Context, "rpc" | "command">,
  endpointIds: readonly string[],
  activeEndpointIds: () => readonly string[],
  snapshots: ReadonlyMap<string, ProviderSnapshot>,
  dependencies: MultiAuditDependencies = {},
): Promise<Registration> {
  const writeFile = dependencies.writeFile ?? writeAuditFile
  let sequence = 0
  let diagnosticSequence = 0
  let latest = { sequence, sessionID: "", ok: false, path: "", error: "" }
  let rpc: Awaited<ReturnType<typeof context.rpc.register<typeof auditRpc>>>

  const performExport = async (sessionID: string) => {
    const active = new Set(activeEndpointIds())
    const entries = endpointIds
      .filter((id) => active.has(id))
      .map((id) => ({
        id,
        snapshot: snapshots.get(id)?.audit ?? { status: "disconnected" as const },
      }))
    try {
      const path = await writeFile(createMultiEndpointAuditReport(entries, dependencies.now?.() ?? new Date()))
      latest = { sequence: ++sequence, sessionID, ok: true, path, error: "" }
      await rpc.events.emit("completed", latest)
      return latest
    } catch (error) {
      latest = { sequence: ++sequence, sessionID, ok: false, path: "", error: failureMessage(error) }
      await rpc.events.emit("completed", latest)
      return latest
    }
  }

  rpc = await context.rpc.register(auditRpc, {
    async export(input) {
      return performExport((input as { sessionID: string }).sessionID)
    },
    async latest() {
      return latest
    },
  })

  try {
    const command = await context.command.transform((editor) => {
      editor.add({
        name: "litellm-diagnostics",
        description: "显示 LiteLLM endpoint 总览；传 endpoint id 查看详情",
        async execute(input) {
          const record = input as unknown as { sessionID: string }
          const requested = requestedEndpoint(input)
          const active = new Set(activeEndpointIds())
          let lines: string[]
          if (requested) {
            if (!endpointIds.includes(requested)) {
              lines = [`未知 LiteLLM endpoint：${requested}`]
            } else if (!active.has(requested)) {
              lines = [
                `Endpoint：${requested}`,
                "状态：未激活",
                "已注册模型：0",
              ]
            } else {
              const snapshot = snapshots.get(requested) ?? { ready: false, models: [], audit: { status: "pending" as const } }
              lines = [`Endpoint：${requested}`, ...createDiagnosticsLines(snapshot)]
            }
          } else {
            lines = [
              `LiteLLM Endpoints · active ${active.size}/${endpointIds.length}`,
              ...endpointIds.map((id) => {
                if (!active.has(id)) return `○ ${id} · 未激活 · models=0`
                const snapshot = snapshots.get(id)
                return `✓ ${id} · ${snapshot?.audit?.status ?? "pending"} · models=${snapshot?.audit?.view?.models.length ?? snapshot?.models.length ?? 0}`
              }),
            ]
          }
          await rpc.events.emit("completed", {
            sequence: ++diagnosticSequence,
            sessionID: record.sessionID,
            ok: true,
            path: "",
            error: "",
            lines,
          })
        },
      })
      editor.add({
        name: "litellm-audit-export",
        description: "导出当前 active LiteLLM endpoints 的模型注册视图",
        async execute({ sessionID }) {
          await performExport(sessionID)
        },
      })
    })
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
