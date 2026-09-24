import { describe, expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import { registerAudit } from "../src/host/audit-command.js"
import { createRegistrationView, type ProviderSnapshot } from "../src/host/register.js"

function harness(snapshot: ProviderSnapshot, writeFile: (report: object) => Promise<string>) {
  let command: { execute: (input: { sessionID: string }) => Promise<void> } | undefined
  let handlers: { export: (input: { sessionID: string }) => Promise<unknown>; latest: () => Promise<unknown> } | undefined
  let emits: unknown[] = []
  let disposed = 0
  const context = {
    rpc: {
      register: async (_schema: unknown, input: typeof handlers) => {
        handlers = input
        return { events: { emit: async (_event: string, value: unknown) => { emits.push(value) } }, dispose: async () => { disposed++ } }
      },
    },
    command: {
      transform: async (register: (editor: { add(value: typeof command): void }) => void) => {
        register({ add(value) { command = value } })
        return { dispose: async () => { disposed++ } }
      },
    },
  } as unknown as Pick<Plugin.Context, "rpc" | "command">
  return {
    context,
    get command() { return command! },
    get handlers() { return handlers! },
    get emits() { return emits },
    get disposed() { return disposed },
    writeFile,
  }
}

const snapshot: ProviderSnapshot = {
  ready: true,
  models: [],
  audit: { status: "empty", view: createRegistrationView([], "https://private.example/v1") },
}

describe("审查导出命令", () => {
  test("命令写入 JSON 并通过事件和 latest 返回绝对路径，无需模型请求", async () => {
    const written: object[] = []
    const h = harness(snapshot, async (report) => {
      written.push(report)
      return "C:/audit/example.json"
    })
    const registration = await registerAudit(h.context, snapshot, { writeFile: h.writeFile })
    expect(await h.handlers.latest()).toEqual({ sequence: 0, sessionID: "", ok: false, path: "", error: "" })
    await h.command.execute({ sessionID: "session-1" })
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({ status: "empty", models: [] })
    expect(h.emits).toEqual([{ sequence: 1, sessionID: "session-1", ok: true, path: "C:/audit/example.json", error: "" }])
    expect(await h.handlers.latest()).toEqual(h.emits[0])
    expect(await h.handlers.export({ sessionID: "session-2" })).toEqual({ sequence: 2, sessionID: "session-2", ok: true, path: "C:/audit/example.json", error: "" })
    await registration.dispose()
    expect(h.disposed).toBe(2)
  })

  test("失败仅传递允许的错误类别，不泄漏异常或影响后续导出", async () => {
    let attempts = 0
    const h = harness(snapshot, async () => {
      attempts++
      if (attempts === 1) throw Object.assign(new Error("sk-fixture-not-real https://private.example"), { code: "EACCES" })
      return "C:/audit/recovered.json"
    })
    const registration = await registerAudit(h.context, snapshot, { writeFile: h.writeFile })
    await h.command.execute({ sessionID: "first" })
    expect(await h.handlers.latest()).toEqual({ sequence: 1, sessionID: "first", ok: false, path: "", error: "审查报告目录不可写" })
    expect(JSON.stringify(h.emits)).not.toContain("private.example")
    expect(JSON.stringify(h.emits)).not.toContain("sk-fixture-not-real")
    await h.command.execute({ sessionID: "second" })
    expect(await h.handlers.latest()).toEqual({ sequence: 2, sessionID: "second", ok: true, path: "C:/audit/recovered.json", error: "" })
    await registration.dispose()
  })
})
