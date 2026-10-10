import assert from "node:assert/strict"
import metadataDiscovery from "../test/fixtures/metadata-priority/synthetic-discovery.json" with { type: "json" }
import metadataCatalog from "../test/fixtures/metadata-priority/modelsdev-subset.json" with { type: "json" }
import { testRender } from "@opentui/solid"
import { RGBA, TextRenderable, type Renderable } from "@opentui/core"
import { createSignal } from "solid-js"
import type { Context } from "@opencode/plugin/tui/plugin"
import { registerAudit } from "../src/host/audit-command.js"
import { registerEndpointActivation } from "../src/host/endpoint-command.js"
import { createDiscoveryLoop } from "../src/host/sync.js"
import type { ProviderSnapshot } from "../src/host/register.js"
import type { EndpointActivation } from "../src/endpoints.js"
import { setupAuditTui } from "../src/tui.js"
import { AuditCard, createAuditResultStore, type AuditResult, type EndpointActivationResult } from "../src/tui-card.js"

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
let auditCompleted!: (event: { data: AuditResult & { lines?: string[] } }) => void
let endpointShown!: (event: { data: EndpointActivationResult }) => void
let render!: (input: { sessionID: string }) => ReturnType<typeof AuditCard>
let stopped = 0
let auditServerHandlers: { latest(input: Record<string, never>): Promise<AuditResult & { lines?: string[] }> } | undefined
let endpointServerHandlers: {
  state(input: Record<string, never>): Promise<EndpointActivationResult>
  set(input: { action: string; endpointId: string }): Promise<EndpointActivationResult>
} | undefined
let dropNextAuditEvent = false
const endpointChoices: Array<string | undefined> = []
const endpointDialogs: Array<{ title: string; options: ReadonlyArray<{ title: string; value: string }> }> = []
const emptyEndpoint: EndpointActivationResult = {
  sequence: 0,
  sessionID: "",
  mode: "all",
  endpointIds: [],
  activeEndpointIds: [],
}
const context = {
  get theme() { return { text: { base: foreground() } } },
  client: { rpc: (schema: { id?: string }) => schema.id === "litellm-endpoints"
    ? ({
        state: async () => endpointServerHandlers ? endpointServerHandlers.state({}) : emptyEndpoint,
        set: async (input: { action: string; endpointId: string }) =>
          endpointServerHandlers ? endpointServerHandlers.set(input) : emptyEndpoint,
        events: { on: (name: string, listener: typeof endpointShown) => {
          if (name === "shown") endpointShown = listener
          return () => { stopped++ }
        } },
      })
    : ({
        latest: async () => auditServerHandlers ? auditServerHandlers.latest({}) : latest,
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
    router: { current: () => ({ type: "session", sessionID: "current" }) },
    toast: { show: () => {} },
    dialog: {
      prompt: async () => undefined,
      clear: () => {},
      select: async (options: { title: string; options: ReadonlyArray<{ title: string; value: string }> }) => {
        endpointDialogs.push(options)
        return endpointChoices.shift()
      },
    },
  },
} as unknown as Context
const cleanup = await setupAuditTui(context, (callback) => {
  tick = callback
  return () => { stopped++ }
})
// Height fits both cards, including the selected metadata and reasoning summary.
const live = await testRender(() => render({ sessionID: "current" }), { width: 110, height: 40 })
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
    fetchLiteLLM: async () => metadataDiscovery,
    getModelsDev: async () => metadataCatalog,
  })
  await diagnosticLoop.start()
  assert.equal(diagnosticSnapshot.audit?.status, "ready")
  assert.equal(diagnosticSnapshot.diagnostics?.cache?.source, "network")
  assert.equal(diagnosticSnapshot.diagnostics?.discovery?.modelsDev.status, "ok")

  let diagnosticsCommand: { execute(input: { sessionID: string }): Promise<void> } | undefined
  let sessionPrompts = 0
  const serverRegistration = await registerAudit({
    rpc: {
      register: async (_schema: unknown, handlers: typeof auditServerHandlers) => {
        const id = typeof _schema === "object" && _schema !== null ? (_schema as { id?: unknown }).id : undefined
        if (id !== "litellm-audit-export") {
          return {
            events: { emit: async () => {} },
            dispose: async () => {},
          }
        }
        auditServerHandlers = handlers
        return {
          events: {
            emit: async (_event: string, value: unknown) => {
              if (dropNextAuditEvent) {
                dropNextAuditEvent = false
                return
              }
              auditCompleted({ data: value as AuditResult & { lines?: string[] } })
            },
          },
          dispose: async () => {},
        }
      },
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
    dropNextAuditEvent = true
    await diagnosticsCommand!.execute({ sessionID: "current" })
    await Bun.sleep(0)
    await live.renderOnce()
    assert.doesNotMatch(live.captureCharFrame(), /LiteLLM Diagnostics/, "dropped live event must not render immediately")
    tick()
    await Bun.sleep(0)
    await live.renderOnce()
    await Bun.sleep(0)
    await live.renderOnce()
    const diagnosticsFrame = live.captureCharFrame()
    assert.match(diagnosticsFrame, /LiteLLM Diagnostics/)
    assert.match(diagnosticsFrame, /状态：正常/)
    assert.match(diagnosticsFrame, /已注册模型：16/)
    assert.match(diagnosticsFrame, /命中 16\/16/)
    assert.match(diagnosticsFrame, /deepseek-v4\.1-flash/)
    assert.match(diagnosticsFrame, /来源 deepseek · 推理 low,high,max/)
    assert.doesNotMatch(diagnosticsFrame, /serving|proof|models_dev_provider/)
    assert.match(diagnosticsFrame, /缓存：network/)
    assert.match(diagnosticsFrame, /models\.dev：ok/)
    assert.match(diagnosticsFrame, /协议 fallback：0/)
    assert.doesNotMatch(diagnosticsFrame, /sk-diagnostics-fixture/)
    assert.equal(sessionPrompts, 0)

    await clickLive("[关闭]")
    assert.doesNotMatch(live.captureCharFrame(), /LiteLLM Diagnostics/, "diagnostics card must be dismissible")

    // PR9 vertical closure: server command -> RPC event -> native selector -> RPC set -> activation mutation.
    let endpointCommand: { execute(input: { sessionID: string }): Promise<void> } | undefined
    let activation: EndpointActivation = { mode: "all" }
    const endpointRegistration = await registerEndpointActivation({
      rpc: {
        register: async (_schema: unknown, handlers: typeof endpointServerHandlers) => {
          endpointServerHandlers = handlers
          return {
            events: {
              emit: async (_event: string, value: unknown) => {
                endpointShown({ data: value as EndpointActivationResult })
              },
            },
            dispose: async () => {},
          }
        },
      },
      command: {
        transform: async (callback: (editor: { add(value: { name: string; execute(input: { sessionID: string }): Promise<void> }): void }) => void) => {
          callback({
            add(value) {
              if (value.name === "litellm-endpoints") endpointCommand = value
            },
          })
          return { dispose: async () => {} }
        },
      },
    } as never, ["default", "company"], () => activation, async (next) => {
      activation = next
    })
    try {
      assert.ok(endpointCommand)
      endpointChoices.push("endpoint:default", "toggle", "back", undefined as never)
      await endpointCommand!.execute({ sessionID: "current" })
      await Bun.sleep(0)
      await Bun.sleep(0)

      assert.deepEqual(activation, { mode: "selected", endpointIds: ["company"] })
      // main list -> endpoint detail -> toggle -> back -> main list (dismissed)
      assert.equal(endpointDialogs.length, 4)
      assert.deepEqual(endpointDialogs[0]?.options.map((item) => item.title), [
        "＋ 新增 endpoint",
        "全部启用",
        "全部停用",
        "✓ default",
        "✓ company",
      ])
      assert.deepEqual(endpointDialogs[1]?.options.map((item) => item.value), ["toggle", "edit", "connect", "delete", "back"])
      assert.equal(endpointDialogs[3]?.options[3]?.title, "○ default")
      assert.equal(endpointDialogs[3]?.options[4]?.title, "✓ company")
    } finally {
      await endpointRegistration.dispose()
    }
  } finally {
    await serverRegistration.dispose()
    await diagnosticLoop.dispose()
  }

  console.log("TUI latest recovery, diagnostics recovery and native endpoint selector vertical paths passed")
} finally {
  live.renderer.destroy()
  cleanup()
  assert.equal(stopped, 4, "polling, audit events, endpoint events and slot must be cleaned up")
}
