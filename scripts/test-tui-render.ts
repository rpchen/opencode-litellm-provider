import assert from "node:assert/strict"
import { testRender } from "@opentui/solid"
import { RGBA, TextRenderable, type Renderable } from "@opentui/core"
import { createSignal } from "solid-js"
import type { Context } from "@opencode/plugin/tui/plugin"
import { registerAudit } from "../src/host/audit-command.js"
import { createDiscoveryLoop } from "../src/host/sync.js"
import type { ProviderSnapshot } from "../src/host/register.js"
import { setupAuditTui } from "../src/tui.js"
import { AuditCard, createAuditResultStore, type AuditResult } from "../src/tui-card.js"

const store = createAuditResultStore()
const lightText = RGBA.fromHex("#1a1a1a")
const darkText = RGBA.fromHex("#eeeeee")
const [foreground, setForeground] = createSignal(lightText)
function assertTextColors(root: Renderable, expected: RGBA) {
  let count = 0
  const visit = (node: Renderable) => {
    if (node instanceof TextRenderable) {
      assert.deepEqual(node.fg.toInts(), expected.toInts(), "card text must use the current theme, not default white")
      count++
    }
    node.getChildren().forEach(visit)
  }
  visit(root)
  return count
}
const actions: string[] = []
let copyFails = false
const report = "C:/Users/example/AppData/Local/opencode/litellm-audit/audit report with a long name.json"
const ui = await testRender(() => AuditCard({
  result: () => store.forSession("current"),
  foreground,
  actions: {
    open: async (path) => { actions.push(`open:${path}`) },
    copy: async (path) => {
      actions.push(`copy:${path}`)
      if (copyFails) throw new Error("private clipboard error")
    },
    manualCopy: async (path) => { actions.push(`manual:${path}`) },
  },
  onDismiss: () => store.dismiss("current"),
}), { width: 110, height: 12 })

async function frame() {
  await ui.renderOnce()
  assertTextColors(ui.renderer.root, foreground())
  return ui.captureCharFrame()
}

async function click(label: string) {
  const lines = (await frame()).split("\n")
  const y = lines.findIndex((line) => line.includes(label))
  assert.notEqual(y, -1, `missing action: ${label}`)
  const prefix = lines[y]!.slice(0, lines[y]!.indexOf(label))
  const x = [...prefix].reduce((width, char) => width + (/\p{Script=Han}/u.test(char) ? 2 : 1), 0)
  await ui.mockMouse.click(x + 2, y)
  await ui.renderOnce()
}

try {
  assert.doesNotMatch(await frame(), /审查报告/)
  store.accept({ sequence: 1, sessionID: "other", ok: true, path: "C:/other.json", error: "" })
  assert.doesNotMatch(await frame(), /C:\/other\.json/)
  store.accept({ sequence: 2, sessionID: "current", ok: true, path: report, error: "" })
  assert.match(await frame(), /审查报告已导出/)
  assert.ok((await frame()).includes(report), "full path must be rendered")
  assert.equal(assertTextColors(ui.renderer.root, lightText), 5, "title, path and all three buttons must be visible in light mode")
  setForeground(darkText)
  await Bun.sleep(0)
  assert.equal(assertTextColors(ui.renderer.root, darkText), 5, "mounted text must follow theme changes without renderOnce")
  setForeground(lightText)
  await Bun.sleep(0)
  assert.equal(assertTextColors(ui.renderer.root, lightText), 5)

  await click("[打开报告]")
  assert.deepEqual(actions, [`open:${report}`])
  await click("[复制路径]")
  assert.deepEqual(actions, [`open:${report}`, `copy:${report}`])
  assert.match(await frame(), /路径已复制到剪贴板/)
  assert.equal(assertTextColors(ui.renderer.root, lightText), 6, "operation feedback must also use the theme")

  copyFails = true
  await click("[复制路径]")
  assert.deepEqual(actions.slice(-2), [`copy:${report}`, `manual:${report}`])
  assert.match(await frame(), /复制失败/)
  assert.doesNotMatch(await frame(), /private clipboard error/)

  const longPath = `C:/Users/example/${"nested-folder/".repeat(12)}final-report.json`
  store.accept({ sequence: 3, sessionID: "current", ok: true, path: longPath, error: "" })
  const wrapped = await frame()
  assert.ok(wrapped.includes(longPath.slice(0, 55)))
  assert.ok(wrapped.includes("final-report.json"), "long path must wrap without truncation")
  assert.doesNotMatch(wrapped, /复制失败/)

  store.accept({ sequence: 4, sessionID: "current", ok: false, path: "", error: "报告目录不可写" })
  assert.match(await frame(), /报告目录不可写/)
  assert.doesNotMatch(await frame(), /复制失败/)
  assert.doesNotMatch(await frame(), /C:\/other\.json/)
  assert.equal(assertTextColors(ui.renderer.root, lightText), 3, "failure title, reason and close action must use the theme")

  await click("[关闭]")
  assert.doesNotMatch(await frame(), /审查报告/)
  store.accept({ sequence: 4, sessionID: "current", ok: true, path: "C:/same-sequence.json", error: "" })
  assert.doesNotMatch(await frame(), /same-sequence/)
  store.accept({ sequence: 5, sessionID: "current", ok: true, path: "C:/new-sequence.json", error: "" })
  assert.match(await frame(), /new-sequence/)
  console.log("TUI rendering, dismiss and mouse actions passed")
} finally {
  ui.renderer.destroy()
}

let latest: AuditResult = { sequence: 0, sessionID: "", ok: false, path: "", error: "" }
let tick!: () => void
let auditCompleted!: (event: { data: AuditResult }) => void
let render!: (input: { sessionID: string }) => ReturnType<typeof AuditCard>
let stopped = 0
const context = {
  get theme() { return { text: { base: foreground() } } },
  client: { rpc: () => ({
    latest: async () => latest,
    events: { on: (name: string, listener: typeof auditCompleted) => {
      if (name === "completed") auditCompleted = listener
      return () => { stopped++ }
    } },
  }) },
  ui: {
    slot: (claim: { render: typeof render }) => {
      render = claim.render
      return () => { stopped++ }
    },
    dialog: { prompt: async () => undefined },
  },
} as unknown as Context
const cleanup = await setupAuditTui(context, (callback) => {
  tick = callback
  return () => { stopped++ }
})
const live = await testRender(() => render({ sessionID: "current" }), { width: 110, height: 20 })
async function clickLive(label: string) {
  await live.renderOnce()
  const lines = live.captureCharFrame().split("\n")
  const y = lines.findIndex((line) => line.includes(label))
  assert.notEqual(y, -1, `missing live action: ${label}`)
  const prefix = lines[y]!.slice(0, lines[y]!.indexOf(label))
  const x = [...prefix].reduce((width, char) => width + (/\p{Script=Han}/u.test(char) ? 2 : 1), 0)
  await live.mockMouse.click(x + 2, y)
  await live.renderOnce()
}
try {
  await live.renderOnce()
  assert.doesNotMatch(live.captureCharFrame(), /审查报告/)
  latest = { sequence: 1, sessionID: "other", ok: true, path: "C:/other.json", error: "" }
  tick()
  await Bun.sleep(0)
  await live.renderOnce()
  assert.doesNotMatch(live.captureCharFrame(), /C:\/other\.json/)
  latest = { sequence: 2, sessionID: "current", ok: true, path: report, error: "" }
  tick()
  await Bun.sleep(0)
  assert.equal(assertTextColors(live.renderer.root, lightText), 5, "latest must mount themed text before forced painting")
  await live.renderOnce()
  assert.match(live.captureCharFrame(), /审查报告已导出/)
  assert.ok(live.captureCharFrame().includes(report), "polling must update the mounted card")
  assert.equal(assertTextColors(live.renderer.root, lightText), 5)

  await clickLive("[关闭]")
  assert.doesNotMatch(live.captureCharFrame(), /审查报告/)
  tick()
  await Bun.sleep(0)
  await live.renderOnce()
  assert.doesNotMatch(live.captureCharFrame(), /审查报告/, "dismissed latest result must not reappear on polling")

  auditCompleted({ data: { sequence: 3, sessionID: "current", ok: true, path: "C:/second.json", error: "" } })
  await Bun.sleep(0)
  assert.equal(assertTextColors(live.renderer.root, lightText), 5)
  setForeground(darkText)
  await Bun.sleep(0)
  assert.equal(assertTextColors(live.renderer.root, darkText), 5, "setup must forward the live host theme getter")
  await live.renderOnce()
  assert.match(live.captureCharFrame(), /C:\/second\.json/)
  assert.ok(!live.captureCharFrame().includes(report), "the next event must replace the previous path")

  // PR7 vertical closure: fixture discovery -> ProviderSnapshot diagnostics -> real command
  // -> real RPC event routing -> diagnostics store -> rendered TUI card.
  const diagnosticSnapshot: ProviderSnapshot = { ready: false, models: [], audit: { status: "disconnected" } }
  const diagnosticConnection = { type: "credential" as const, id: "diag-connection", label: "diag", method: "key" as const }
  const diagnosticLoop = createDiscoveryLoop({
    integration: {
      connection: {
        active: async () => diagnosticConnection,
        resolve: async () => ({
          type: "key",
          key: "sk-diagnostics-fixture",
          configuration: { url: "https://litellm.example" },
        }),
      },
    },
    provider: { reload: async () => {} },
    event: {
      subscribe: ({ signal } = {}) => ({
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise<IteratorResult<never>>((resolve) => {
            const finish = () => resolve({ value: undefined, done: true })
            if (signal?.aborted) finish()
            else signal?.addEventListener("abort", finish, { once: true })
          }),
        }),
      }),
    },
  }, diagnosticSnapshot, {
    pollInterval: 30,
    contextTierCap: true,
    protocolOverrides: {},
    conversationFeedback: false,
  }, {
    scheduler: { setTimeout: () => ({}), clearTimeout: () => {} },
    fetchLiteLLM: async () => ({
      data: [{
        model_name: "gpt-diagnostics",
        litellm_params: { model: "openai/gpt-diagnostics" },
        model_info: {
          supported_endpoints: ["/v1/responses"],
          max_input_tokens: 100000,
          max_output_tokens: 10000,
        },
      }],
    }),
    getModelsDev: async () => ({
      openai: {
        models: {
          "gpt-diagnostics": {
            id: "gpt-diagnostics",
            release_date: "2026-05-01",
            modalities: { input: ["text"], output: ["text"] },
          },
        },
      },
    }),
  })
  await diagnosticLoop.start()
  assert.equal(diagnosticSnapshot.audit?.status, "ready")
  assert.equal(diagnosticSnapshot.diagnostics?.cache?.source, "network")
  assert.equal(diagnosticSnapshot.diagnostics?.discovery?.modelsDev.status, "ok")

  let diagnosticsCommand: { execute(input: { sessionID: string }): Promise<void> } | undefined
  let sessionPrompts = 0
  const serverRegistration = await registerAudit({
    rpc: {
      register: async () => ({
        events: {
          emit: async (_event: string, value: unknown) => {
            auditCompleted({ data: value as AuditResult })
          },
        },
        dispose: async () => {},
      }),
    },
    command: {
      transform: async (callback: (editor: { add(value: { name: string; execute(input: { sessionID: string }): Promise<void> }): void }) => void) => {
        callback({
          add(value) {
            if (value.name === "litellm-diagnostics") diagnosticsCommand = value
          },
        })
        return { dispose: async () => {} }
      },
    },
    session: {
      prompt: async () => {
        sessionPrompts += 1
        throw new Error("diagnostics must not create a model turn")
      },
    },
  } as never, diagnosticSnapshot, {
    writeFile: async () => "C:/unused.json",
  })

  try {
    assert.ok(diagnosticsCommand)
    await diagnosticsCommand!.execute({ sessionID: "current" })
    await Bun.sleep(0)
    await live.renderOnce()
    await Bun.sleep(0)
    await live.renderOnce()
    const diagnosticsFrame = live.captureCharFrame()
    assert.match(diagnosticsFrame, /LiteLLM Diagnostics/)
    assert.match(diagnosticsFrame, /状态：正常/)
    assert.match(diagnosticsFrame, /已注册模型：1/)
    assert.match(diagnosticsFrame, /缓存：network/)
    assert.match(diagnosticsFrame, /models\.dev：ok/)
    assert.match(diagnosticsFrame, /协议 fallback：0/)
    assert.doesNotMatch(diagnosticsFrame, /sk-diagnostics-fixture/)
    assert.equal(sessionPrompts, 0)

    await clickLive("[关闭]")
    assert.doesNotMatch(live.captureCharFrame(), /LiteLLM Diagnostics/, "diagnostics card must be dismissible")
  } finally {
    await serverRegistration.dispose()
    await diagnosticLoop.dispose()
  }

  console.log("TUI latest recovery, live polling and PR7 diagnostics vertical path passed")
} finally {
  live.renderer.destroy()
  cleanup()
  assert.equal(stopped, 4, "polling, audit events, endpoint events and slot must be cleaned up")
}
