import { createEffect, createSignal, Show } from "solid-js/dist/solid.js"
import type { Context } from "@opencode/plugin/tui/plugin"
import { copyAuditPath, openAuditReport } from "./tui-actions.js"

export interface AuditResult {
  sequence: number
  sessionID: string
  ok: boolean
  path: string
  error: string
}

export interface AuditCardActions {
  open: (path: string) => Promise<void>
  copy: (path: string) => Promise<void>
  manualCopy: (path: string) => Promise<unknown>
}

export function createAuditResultStore() {
  const [results, setResults] = createSignal<Record<string, AuditResult>>({})
  let seen = 0
  return {
    forSession: (sessionID: string) => results()[sessionID],
    accept(result: AuditResult) {
      if (result.sequence <= seen || !result.sessionID) return
      seen = result.sequence
      setResults((previous) => ({ ...previous, [result.sessionID]: result }))
    },
  }
}

export function createAuditCardController(actions: AuditCardActions) {
  const [feedback, setFeedback] = createSignal("")
  let version = 0
  return {
    feedback,
    reset: () => { version++; setFeedback("") },
    async act(kind: "open" | "copy", path: string) {
      const current = ++version
      try {
        await actions[kind](path)
        if (current === version) setFeedback(kind === "open" ? "已请求系统打开报告" : "路径已复制到剪贴板")
      } catch {
        if (current !== version) return
        setFeedback(kind === "open" ? "打开失败，请使用上方路径手动查找文件" : "复制失败，请在输入框中手动复制路径")
        if (kind === "copy") {
          try {
            await actions.manualCopy(path)
          } catch {
            // 路径仍在卡片中，不再展示底层系统错误。
          }
        }
      }
    },
  }
}

export function AuditCard(props: {
  result: () => AuditResult | undefined
  actions: AuditCardActions
}) {
  const controller = createAuditCardController(props.actions)
  createEffect(() => {
    props.result()?.sequence
    controller.reset()
  })
  return Show({
    get when() { return props.result() },
    keyed: true,
    children: (result: AuditResult) =>
      <box flexDirection="column" paddingLeft={2} paddingRight={2} marginBottom={1}>
        <text>{result.ok ? "LiteLLM 审查报告已导出" : "LiteLLM 审查报告导出失败"}</text>
        {result.ok ? <>
          <text wrapMode="char" onMouseUp={() => { void controller.act("open", result.path) }}><u>{result.path}</u></text>
          <box flexDirection="row" gap={2}>
            <text onMouseUp={() => { void controller.act("open", result.path) }}>[打开报告]</text>
            <text onMouseUp={() => { void controller.act("copy", result.path) }}>[复制路径]</text>
          </box>
        </> : <text>{result.error}</text>}
        {Show({
          get when() { return controller.feedback() || undefined },
          keyed: true,
          children: (message: string) => <text>{message}</text>,
        })}
      </box>,
  })
}

export function auditCardActions(context: Pick<Context, "ui">): AuditCardActions {
  return {
    open: openAuditReport,
    copy: copyAuditPath,
    manualCopy: (path) => context.ui.dialog.prompt({ title: "手动复制报告路径", value: path }),
  }
}
