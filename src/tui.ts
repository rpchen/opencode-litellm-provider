import { define, type Context } from "@opencode/plugin/tui/plugin"
import { auditRpc } from "./host/audit-rpc.js"
import { endpointRpc } from "./host/endpoint-rpc.js"
import { createEndpointUi, type CredentialClient, type EndpointRpcClient, type EndpointStateView } from "./tui-endpoints.js"
import {
  ProviderCards,
  auditCardActions,
  createAuditResultStore,
  createDiagnosticsResultStore,
  type AuditResult,
  type DiagnosticsResult,
  type EndpointActivationResult,
} from "./tui-card.js"

type LatestVisibleResult = AuditResult & { lines?: string[] }

function scheduleRefresh(refresh: () => void): () => void {
  const timer = setInterval(refresh, 1000)
  return () => clearInterval(timer)
}

export async function setupAuditTui(
  context: Context,
  schedule: (refresh: () => void) => () => void = scheduleRefresh,
) {
  const rpc = context.client.rpc(auditRpc)
  const endpointClient = context.client.rpc(endpointRpc)
  const store = createAuditResultStore()
  const diagnosticsStore = createDiagnosticsResultStore()
  const actions = auditCardActions(context)
  let disposed = false
  const endpointUi = createEndpointUi({
    dialog: context.ui.dialog as never,
    toast: context.ui.toast as never,
    rpc: endpointClient as unknown as EndpointRpcClient,
    client: context.client as unknown as CredentialClient,
    isDisposed: () => disposed,
  })
  let endpointSequence = 0
  let endpointDialogRunning = false
  let pendingEndpoint: EndpointActivationResult | undefined

  const acceptVisible = (data: LatestVisibleResult) => {
    if (Array.isArray(data.lines)) {
      diagnosticsStore.accept({
        sequence: data.sequence,
        sessionID: data.sessionID,
        lines: data.lines,
      })
    } else {
      store.accept(data)
    }
  }

  const currentSessionIs = (sessionID: string) => {
    const route = context.ui.router.current()
    return route.type === "session" && route.sessionID === sessionID
  }

  const showEndpoints = async (initial: EndpointActivationResult): Promise<void> => {
    if (
      disposed ||
      !initial.sessionID ||
      initial.sequence <= endpointSequence ||
      !currentSessionIs(initial.sessionID)
    ) return
    if (endpointDialogRunning) {
      pendingEndpoint = initial
      return
    }

    endpointSequence = initial.sequence
    endpointDialogRunning = true
    try {
      await endpointUi.run(initial as unknown as EndpointStateView)
    } catch {
      if (!disposed) {
        context.ui.toast.show({
          variant: "error",
          message: "LiteLLM endpoint 管理操作失败，请重试",
        })
      }
    } finally {
      endpointDialogRunning = false
      const next = pendingEndpoint
      pendingEndpoint = undefined
      if (next && !disposed) void showEndpoints(next)
    }
  }

  const stop = rpc.events.on("completed", (event) => {
    acceptVisible(event.data as unknown as LatestVisibleResult)
  })
  const stopEndpoints = endpointClient.events.on("shown", (event) => {
    void showEndpoints(event.data as unknown as EndpointActivationResult)
  })
  const remove = context.ui.slot({
    before: "session.composer.top",
    render: ({ sessionID }) => ProviderCards({
      auditResult: () => sessionID ? store.forSession(sessionID) : undefined,
      diagnosticsResult: () => sessionID ? diagnosticsStore.forSession(sessionID) : undefined,
      foreground: () => context.theme.text.base,
      actions,
      dismissAudit: () => { if (sessionID) store.dismiss(sessionID) },
      dismissDiagnostics: () => { if (sessionID) diagnosticsStore.dismiss(sessionID) },
    }),
  })

  let refreshing = false
  const refresh = async () => {
    if (refreshing || disposed) return
    refreshing = true
    try {
      try {
        const result = await rpc.latest({}) as unknown as LatestVisibleResult
        if (!disposed) acceptVisible(result)
      } catch {
        // 服务器可能尚未完成插件注册；后续轮询会继续尝试。
      }
      try {
        const state = await endpointClient.state({}) as unknown as EndpointActivationResult
        if (!disposed) void showEndpoints(state)
      } catch {
        // endpoint RPC 与主插件异步就绪；后续轮询会继续尝试。
      }
    } finally {
      refreshing = false
    }
  }
  const stopRefresh = schedule(() => { void refresh() })
  await refresh()
  return () => {
    disposed = true
    if (endpointDialogRunning) context.ui.dialog.clear()
    stopRefresh()
    stop()
    stopEndpoints()
    remove()
  }
}

export default define({ id: "litellm", setup: setupAuditTui })
