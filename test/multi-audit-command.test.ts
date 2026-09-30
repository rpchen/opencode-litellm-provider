import { describe, expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import { registerMultiEndpointAudit } from "../src/host/multi-audit-command.js"
import { createRegistrationView, type ProviderSnapshot } from "../src/host/register.js"

function snapshot(id: string): ProviderSnapshot {
  const view = createRegistrationView([{
    id: `model-${id}`,
    name: `model-${id}`,
    protocol: "chat",
    package: "@opencode/ai/providers/openai-compatible",
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: [],
    released: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    limit: { context: 8192, input: 8192, output: 1024 },
  }], "https://private.example/v1")
  return {
    ready: true,
    models: [],
    audit: { status: "ready", view },
  }
}

function harness() {
  const commands = new Map<string, { execute(input: Record<string, unknown>): Promise<void> }>()
  let handlers: { export(input: { sessionID: string }): Promise<unknown>; latest(): Promise<unknown> } | undefined
  const events: Array<{ name: string; value: unknown }> = []
  let disposed = 0
  const context = {
    rpc: {
      register: async (_schema: unknown, input: typeof handlers) => {
        handlers = input
        return {
          events: {
            emit: async (name: string, value: unknown) => { events.push({ name, value }) },
          },
          dispose: async () => { disposed++ },
        }
      },
    },
    command: {
      transform: async (register: (editor: { add(command: { name: string; execute(input: Record<string, unknown>): Promise<void> }): void }) => void) => {
        register({ add(command) { commands.set(command.name, command) } })
        return { dispose: async () => { disposed++ } }
      },
    },
  } as unknown as Pick<Plugin.Context, "rpc" | "command">
  return {
    context,
    commands,
    events,
    get handlers() { return handlers! },
    get disposed() { return disposed },
  }
}

describe("PR9 multi-endpoint diagnostics and audit", () => {
  test("audit report contains only active endpoints", async () => {
    const h = harness()
    const snapshots = new Map([
      ["default", snapshot("default")],
      ["company", snapshot("company")],
    ])
    let active = ["company"]
    const reports: object[] = []
    const registration = await registerMultiEndpointAudit(
      h.context,
      ["default", "company"],
      () => active,
      snapshots,
      { writeFile: async (report) => { reports.push(report); return "C:/audit/multi.json" } },
    )

    await h.handlers.export({ sessionID: "s1" })
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      schemaVersion: 2,
      endpoints: [{ id: "company" }],
    })
    expect(JSON.stringify(reports[0])).not.toContain('"id": "default"')

    active = []
    await h.handlers.export({ sessionID: "s2" })
    expect(reports[1]).toMatchObject({ schemaVersion: 2, endpoints: [] })

    await registration.dispose()
    expect(h.disposed).toBe(2)
  })

  test("diagnostics no-arg is overview and endpoint arg is scoped detail", async () => {
    const h = harness()
    const snapshots = new Map([
      ["default", snapshot("default")],
      ["company", snapshot("company")],
    ])
    const registration = await registerMultiEndpointAudit(
      h.context,
      ["default", "company"],
      () => ["company"],
      snapshots,
      { writeFile: async () => "C:/audit/multi.json" },
    )
    const command = h.commands.get("litellm-diagnostics")!

    await command.execute({ sessionID: "overview", prompt: { text: "" } })
    const overview = h.events.at(-1)!.value as { lines: string[] }
    expect(overview.lines.join("\n")).toContain("active 1/2")
    expect(overview.lines.join("\n")).toContain("○ default · 未激活")
    expect(overview.lines.join("\n")).toContain("✓ company")

    await command.execute({ sessionID: "detail", prompt: { text: "  company  " } })
    const detail = h.events.at(-1)!.value as { lines: string[] }
    expect(detail.lines[0]).toBe("Endpoint：company")
    expect(detail.lines.join("\n")).toContain("状态：正常")
    expect(detail.lines.join("\n")).not.toContain("LiteLLM Endpoints · active")

    await command.execute({ sessionID: "unknown", prompt: { text: "missing" } })
    const unknown = h.events.at(-1)!.value as { lines: string[] }
    expect(unknown.lines).toEqual(["未知 LiteLLM endpoint：missing"])

    await registration.dispose()
  })
})
