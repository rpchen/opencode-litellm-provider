import type { Plugin } from "@opencode/plugin"
import { createMultiEndpointAuditReport } from "./audit.js"
import { writeAuditFile } from "./audit-file.js"
import { auditRpc } from "./audit-rpc.js"
import { createDiagnosticsLines } from "./diagnostics.js"
import {
  applyErrorLabel,
  credentialLabel,
  statusLabel,
  userVisibleStatus,
} from "./endpoint-state.js"
import { publicationRpc } from "./publication-rpc.js"
import { endpointStateOf, type ProviderSnapshot, type Registration } from "./register.js"

interface MultiAuditDependencies {
  writeFile?: typeof writeAuditFile
  now?: () => Date
}

type LatestVisibleResult = {
  sequence: number
  sessionID: string
  ok: boolean
  path: string
  error: string
  lines?: string[]
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
  const prompt = record.prompt
  if (typeof prompt === "object" && prompt !== null) {
    const text = (prompt as Record<string, unknown>).text
    if (typeof text === "string") return text.trim()
  }
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
  let latest: LatestVisibleResult = { sequence, sessionID: "", ok: false, path: "", error: "" }
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

  const publication = await context.rpc.register(publicationRpc, {
    async state(input: unknown) {
      const { endpointId } = input as { endpointId?: string }
      const candidates = endpointId ? [snapshots.get(endpointId)] : [...snapshots.values()]
      const found = candidates.find((item) => item?.diagnostics?.publication !== undefined)
      return found?.diagnostics?.publication ?? {
        discovered: 0,
        publishable: [],
        lkgIDs: [],
        withheld: [],
        partial: false,
        unusable: false,
        regressions: [],
        discrepancies: [],
        conflicts: [],
      }
    },
  } as never)


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
            } else {
              // Diagnostics detail never degrades to a placeholder. Every configured
              // endpoint — including disabled, invalid, credential-missing — gets a
              // complete canonical record derived from the same source as /litellm-endpoints.
              const snapshot = snapshots.get(requested)
              const state = snapshot ? endpointStateOf(snapshot, requested) : {
                endpointId: requested,
                desired: "disabled" as const,
                validation: { kind: "ok" as const },
                credential: "unknown" as const,
                applied: { kind: "not-applied" as const },
              }
              const status = statusLabel(userVisibleStatus(state))
              const desired = state.desired === "enabled" ? "已启用" : "未启用"
              const validation = state.validation.kind === "ok" ? "合法" : `非法（${state.validation.reason}）`
              const applied = state.applied.kind === "active"
                ? `已生效（${state.applied.modelCount} 个模型${state.applied.lastDiscoveryAt ? `，最近成功发现 ${state.applied.lastDiscoveryAt}` : ""}）`
                : state.applied.kind === "not-applied"
                  ? "未生效"
                  : `出错（${applyErrorLabel(state.applied.category)}${state.applied.message ? `：${state.applied.message}` : ""}）`
              const registeredModelCount = snapshot?.audit?.view?.models.length ?? snapshot?.models.length ?? 0
              lines = [
                `Endpoint：${requested} · 状态：${status} · 期望：${desired} · 配置：${validation} · 凭据：${credentialLabel(state.credential)} · Runtime：${applied} · 当前注册模型数：${registeredModelCount}`,
                ...createDiagnosticsLines(snapshot ?? { ready: false, models: [], audit: { status: "disconnected" } }),
              ]
            }
          } else {
            lines = [
              `LiteLLM Endpoints · active ${active.size}/${endpointIds.length}`,
              ...endpointIds.map((id) => {
                const snapshot = snapshots.get(id)
                const fallbackState = {
                  endpointId: id,
                  desired: (active.has(id) ? "enabled" : "disabled") as "enabled" | "disabled",
                  validation: { kind: "ok" as const },
                  credential: "unknown" as const,
                  applied: { kind: "not-applied" as const },
                }
                const state = snapshot ? endpointStateOf(snapshot, id) : fallbackState
                const marker = state.desired === "enabled" ? "✓" : "○"
                const models = snapshot?.audit?.view?.models.length ?? snapshot?.models.length ?? 0
                return `${marker} ${id} · ${state.endpointId === "default" ? "litellm" : `litellm-${id}`} · ${statusLabel(userVisibleStatus(state))} · models=${models}`
              }),
            ]
          }
          latest = {
            sequence: ++diagnosticSequence,
            sessionID: record.sessionID,
            ok: true,
            path: "",
            error: "",
            lines,
          }
          await rpc.events.emit("completed", latest)
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
        await publication.dispose()
        await rpc.dispose()
      },
    }
  } catch (error) {
    await publication.dispose()
    await rpc.dispose()
    throw error
  }
}
