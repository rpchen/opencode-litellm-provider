import { define, type Context } from "@opencode/plugin/tui/plugin"
import { auditRpc } from "./host/audit-rpc.js"
import {
  AuditCard,
  DiagnosticsCard,
  auditCardActions,
  createAuditResultStore,
  createDiagnosticsResultStore,
  type AuditResult,
  type DiagnosticsResult,
} from "./tui-card.js"

function scheduleRefresh(refresh: () => void): () => void {
  const timer = setInterval(refresh, 1000)
  return () => clearInterval(timer)
}

export async function setupAuditTui(
  context: Context,
  schedule: (refresh: () => void) => () => void = scheduleRefresh,
) {
  const rpc = context.client.rpc(auditRpc)
  const store = createAuditResultStore()
  const diagnosticsStore = createDiagnosticsResultStore()
  const actions = auditCardActions(context)
  const stop = rpc.events.on("completed", (event) => store.accept(event.data as unknown as AuditResult))
  const stopDiagnostics = rpc.events.on(
    "diagnostics",
    (event) => diagnosticsStore.accept(event.data as unknown as DiagnosticsResult),
  )
  const remove = context.ui.slot({
    before: "session.composer.top",
    render: ({ sessionID }) => AuditCard({
      result: () => sessionID ? store.forSession(sessionID) : undefined,
      foreground: () => context.theme.text.base,
      actions,
    }),
  })
  const removeDiagnostics = context.ui.slot({
    before: "session.composer.top",
    render: ({ sessionID }) => DiagnosticsCard({
      result: () => sessionID ? diagnosticsStore.forSession(sessionID) : undefined,
      foreground: () => context.theme.text.base,
    }),
  })
  let refreshing = false
  let disposed = false
  const refresh = async () => {
    if (refreshing || disposed) return
    refreshing = true
    try {
      const [result, diagnostics] = await Promise.all([
        rpc.latest({}) as Promise<AuditResult>,
        rpc.latestDiagnostics({}) as Promise<DiagnosticsResult>,
      ])
      if (!disposed) {
        store.accept(result)
        diagnosticsStore.accept(diagnostics)
      }
    } catch {
      // 服务器可能尚未完成插件注册；后续轮询会继续尝试。
    } finally {
      refreshing = false
    }
  }
  const stopRefresh = schedule(() => { void refresh() })
  await refresh()
  return () => {
    disposed = true
    stopRefresh()
    stop()
    stopDiagnostics()
    remove()
    removeDiagnostics()
  }
}

export default define({ id: "litellm", setup: setupAuditTui })
