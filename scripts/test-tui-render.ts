import assert from "node:assert/strict"
import { testRender } from "@opentui/solid"
import { RGBA, TextRenderable, type Renderable } from "@opentui/core"
import { createSignal } from "solid-js"
import type { Context } from "@opencode/plugin/tui/plugin"
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
  assert.equal(assertTextColors(ui.renderer.root, lightText), 4, "title, path and both buttons must be visible in light mode")
  setForeground(darkText)
  await Bun.sleep(0)
  assert.equal(assertTextColors(ui.renderer.root, darkText), 4, "mounted text must follow theme changes without renderOnce")
  setForeground(lightText)
  await Bun.sleep(0)
  assert.equal(assertTextColors(ui.renderer.root, lightText), 4)

  await click("[打开报告]")
  assert.deepEqual(actions, [`open:${report}`])
  await click("[复制路径]")
  assert.deepEqual(actions, [`open:${report}`, `copy:${report}`])
  assert.match(await frame(), /路径已复制到剪贴板/)
  assert.equal(assertTextColors(ui.renderer.root, lightText), 5, "operation feedback must also use the theme")

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
  assert.equal(assertTextColors(ui.renderer.root, lightText), 2, "failure title and reason must use the theme")
  console.log("TUI rendering and mouse actions passed")
} finally {
  ui.renderer.destroy()
}

let latest: AuditResult = { sequence: 0, sessionID: "", ok: false, path: "", error: "" }
let tick!: () => void
let completed!: (event: { data: AuditResult }) => void
let render!: (input: { sessionID: string }) => ReturnType<typeof AuditCard>
let stopped = 0
const context = {
  get theme() { return { text: { base: foreground() } } },
  client: { rpc: () => ({
    latest: async () => latest,
    events: { on: (_name: string, listener: typeof completed) => { completed = listener; return () => { stopped++ } } },
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
const live = await testRender(() => render({ sessionID: "current" }), { width: 110, height: 12 })
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
  assert.equal(assertTextColors(live.renderer.root, lightText), 4, "latest must mount themed text before forced painting")
  await live.renderOnce()
  assert.match(live.captureCharFrame(), /审查报告已导出/)
  assert.ok(live.captureCharFrame().includes(report), "polling must update the mounted card")
  completed({ data: { sequence: 3, sessionID: "current", ok: true, path: "C:/second.json", error: "" } })
  await Bun.sleep(0)
  assert.equal(assertTextColors(live.renderer.root, lightText), 4)
  setForeground(darkText)
  await Bun.sleep(0)
  assert.equal(assertTextColors(live.renderer.root, darkText), 4, "setup must forward the live host theme getter")
  await live.renderOnce()
  assert.match(live.captureCharFrame(), /C:\/second\.json/)
  assert.ok(!live.captureCharFrame().includes(report), "the next event must replace the previous path")
  console.log("TUI latest recovery and live polling passed")
} finally {
  live.renderer.destroy()
  cleanup()
  assert.equal(stopped, 3, "polling, events and slot must be cleaned up")
}
