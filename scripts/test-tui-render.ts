import assert from "node:assert/strict"
import { testRender } from "@opentui/solid"
import { AuditCard, createAuditResultStore } from "../src/tui-card.js"

const store = createAuditResultStore()
const actions: string[] = []
let copyFails = false
const report = "C:/Users/example/AppData/Local/opencode/litellm-audit/audit report with a long name.json"
const ui = await testRender(() => AuditCard({
  result: () => store.forSession("current"),
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

  await click("[打开报告]")
  assert.deepEqual(actions, [`open:${report}`])
  await click("[复制路径]")
  assert.deepEqual(actions, [`open:${report}`, `copy:${report}`])
  assert.match(await frame(), /路径已复制到剪贴板/)

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
  console.log("TUI rendering and mouse actions passed")
} finally {
  ui.renderer.destroy()
}
