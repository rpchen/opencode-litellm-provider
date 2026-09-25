import { define, type Context } from "@opencode/plugin/tui/plugin"
import { auditRpc } from "./host/audit-rpc.js"
import { AuditCard, auditCardActions, createAuditResultStore, type AuditResult } from "./tui-card.js"

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
  const actions = auditCardActions(context)
  const stop = rpc.events.on("completed", (event) => store.accept(event.data as unknown as AuditResult))
  const remove = context.ui.slot({
    before: "session.composer.top",
    render: ({ sessionID }) => AuditCard({
      result: () => sessionID ? store.forSession(sessionID) : undefined,
      foreground: () => context.theme.text.base,
      actions,
    }),
  })
  let refreshing = false
  let disposed = false
  const refresh = async () => {
    if (refreshing || disposed) return
    refreshing = true
    try {
      const result = await rpc.latest({}) as AuditResult
      if (!disposed) store.accept(result)
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
    remove()
  }
}

export default define({ id: "litellm", setup: setupAuditTui })
