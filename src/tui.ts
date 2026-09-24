import { define } from "@opencode/plugin/tui/plugin"
import { auditRpc } from "./host/audit-rpc.js"
import { AuditCard, auditCardActions, createAuditResultStore, type AuditResult } from "./tui-card.js"

export default define({
  id: "litellm",
  async setup(context) {
    const rpc = context.client.rpc(auditRpc)
    const store = createAuditResultStore()
    const actions = auditCardActions(context)
    const stop = rpc.events.on("completed", (event) => store.accept(event.data as unknown as AuditResult))
    const remove = context.ui.slot({
      before: "session.composer.top",
      render: ({ sessionID }) => AuditCard({ result: () => sessionID ? store.forSession(sessionID) : undefined, actions }),
    })
    try {
      store.accept(await rpc.latest({}) as AuditResult)
    } catch {
      // 服务器可能尚未完成插件注册；后续事件仍能报告导出结果。
    }
    return () => {
      stop()
      remove()
    }
  },
})
