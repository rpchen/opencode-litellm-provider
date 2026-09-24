import { describe, expect, test } from "bun:test"
import type { Context } from "@opencode/plugin/tui/plugin"
import tui, { setupAuditTui } from "../src/tui.js"
import { createAuditCardController, createAuditResultStore, type AuditResult } from "../src/tui-card.js"
import { copyAuditPath, openAuditReport } from "../src/tui-actions.js"

const success = (sequence: number, sessionID: string, path: string): AuditResult => ({
  sequence, sessionID, ok: true, path, error: "",
})

function harness(latest: () => Promise<AuditResult>) {
  let listener: ((event: { data: AuditResult }) => void) | undefined
  let slot: { before: string; render: (input: { sessionID?: string }) => unknown } | undefined
  let stopped = 0
  const context = {
    client: { rpc: () => ({ latest, events: { on: (_event: string, on: typeof listener) => {
      listener = on
      return () => { stopped++ }
    } } }) },
    ui: { slot: (claim: typeof slot) => {
      slot = claim
      return () => { stopped++ }
    }, dialog: { prompt: async () => undefined } },
  } as unknown as Context
  return {
    context,
    get slot() { return slot },
    emit: (value: AuditResult) => listener?.({ data: value }),
    get stopped() { return stopped },
  }
}

describe("TUI 会话卡片", () => {
  test("注册在会话输入框上方，订阅事件并在退出时清理", async () => {
    const h = harness(async () => success(1, "session-1", "C:/audit/report.json"))
    const cleanup = await tui.setup(h.context)
    expect(h.slot?.before).toBe("session.composer.top")
    expect(typeof h.slot?.render).toBe("function")
    h.emit(success(2, "session-2", "C:/audit/other.json"))
    if (cleanup) await cleanup()
    expect(h.stopped).toBe(2)
  })

  test("完成事件丢失后 latest 收敛，查询失败可重试且卸载停止轮询", async () => {
    let tick!: () => void
    let latest = success(0, "current", "C:/initial.json")
    let requests = 0
    let fail = false
    let stopped = 0
    const h = harness(async () => {
      requests++
      if (fail) throw new Error("unavailable")
      return latest
    })
    const cleanup = await setupAuditTui(h.context, (callback) => {
      tick = callback
      return () => { stopped++ }
    })
    expect(requests).toBe(1)
    fail = true
    tick()
    await Bun.sleep(0)
    expect(requests).toBe(2)
    fail = false
    latest = success(1, "current", "C:/later.json")
    tick()
    await Bun.sleep(0)
    expect(requests).toBe(3)
    if (cleanup) await cleanup()
    expect(stopped).toBe(1)
    tick()
    await Bun.sleep(0)
    expect(requests).toBe(3)
    expect(h.stopped).toBe(2)
  })

  test("慢查询不堆叠，卸载后迟到结果不再提交", async () => {
    let finish!: (value: AuditResult) => void
    let requests = 0
    let tick!: () => void
    const h = harness(() => {
      requests++
      return new Promise<AuditResult>((resolve) => { finish = resolve })
    })
    const setup = setupAuditTui(h.context, (callback) => {
      tick = callback
      return () => {}
    })
    tick()
    expect(requests).toBe(1)
    finish(success(1, "current", "C:/initial.json"))
    const cleanup = await setup
    tick()
    tick()
    expect(requests).toBe(2)
    if (cleanup) await cleanup()
    finish(success(2, "current", "C:/late.json"))
    await Bun.sleep(0)
    tick()
    expect(requests).toBe(2)
  })

  test("最新查询与事件乱序时去重，多会话路径互不串联", async () => {
    const store = createAuditResultStore()
    store.accept(success(2, "second", "C:/second.json"))
    store.accept(success(1, "first", "C:/old.json"))
    expect(store.forSession("first")).toBeUndefined()
    expect(store.forSession("second")?.path).toBe("C:/second.json")
    store.accept(success(3, "first", "C:/first.json"))
    expect(store.forSession("first")?.path).toBe("C:/first.json")
    expect(store.forSession("second")?.path).toBe("C:/second.json")
    store.accept({ ...success(4, "first", ""), ok: false, error: "审查报告目录不可写" })
    expect(store.forSession("first")?.error).toBe("审查报告目录不可写")
    expect(store.forSession("second")?.ok).toBeTrue()
    store.accept(success(5, "", "C:/unassigned.json"))
    expect(store.forSession("")).toBeUndefined()
  })

  test("打开与复制保留完整路径，失败反馈不泄漏底层异常", async () => {
    const path = "C:/Users/example/AppData/Local/opencode/litellm-audit/long report.json"
    const actions: Array<string> = []
    const controller = createAuditCardController({
      open: async (input) => { actions.push(`open:${input}`) },
      copy: async (input) => { actions.push(`copy:${input}`) },
      manualCopy: async () => { actions.push("manual") },
    })
    await controller.act("open", path)
    expect(controller.feedback()).toBe("已请求系统打开报告")
    await controller.act("copy", path)
    expect(controller.feedback()).toBe("路径已复制到剪贴板")
    expect(actions).toEqual([`open:${path}`, `copy:${path}`])
    controller.reset()
    expect(controller.feedback()).toBe("")
    const failure = createAuditCardController({
      open: async () => { throw new Error("secret-open-error") },
      copy: async () => { throw new Error("secret-clipboard-error") },
      manualCopy: async (input) => { expect(input).toBe(path); actions.push("manual") },
    })
    await failure.act("open", path)
    expect(failure.feedback()).toContain("打开失败")
    await failure.act("copy", path)
    expect(failure.feedback()).toContain("复制失败")
    expect(failure.feedback()).not.toContain("secret")
    expect(actions.at(-1)).toBe("manual")
  })

  test("新的导出结果不会显示先前操作迟到的反馈", async () => {
    let finish!: () => void
    const controller = createAuditCardController({
      open: async () => new Promise<void>((resolve) => { finish = resolve }),
      copy: async () => {},
      manualCopy: async () => {},
    })
    const pending = controller.act("open", "C:/old.json")
    controller.reset()
    finish()
    await pending
    expect(controller.feedback()).toBe("")
  })

  test("Windows 平台打开和复制调用不把路径拼入命令字符串", async () => {
    if (process.platform !== "win32") return
    const path = "C:/report/name'; secret marker.json"
    const called: Array<{ args: string[]; env: NodeJS.ProcessEnv | undefined }> = []
    const runner = (async (_command: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
      called.push({ args, env: options.env })
      return { stdout: "", stderr: "" }
    }) as never
    await openAuditReport(path, runner)
    await copyAuditPath(path, runner)
    expect(called).toHaveLength(2)
    for (const call of called) {
      expect(call.env?.OPENCODE_LITELLM_AUDIT_PATH).toBe(path)
      expect(call.args.join(" ")).not.toContain(path)
    }
  })

  test("服务器尚未就绪时仍注册卡片并接收后续事件", async () => {
    const h = harness(async () => { throw new Error("not-ready") })
    const cleanup = await tui.setup(h.context)
    expect(h.slot?.before).toBe("session.composer.top")
    h.emit(success(1, "session-1", "C:/audit/retry.json"))
    if (cleanup) await cleanup()
  })
})
