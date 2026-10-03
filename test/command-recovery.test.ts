import { expect, test } from "bun:test"
import { registerMultiEndpointAudit } from "../src/host/multi-audit-command.js"

test("多 endpoint diagnostics 即使 completed 事件丢失也能从 latest 恢复", async () => {
  let diagnostics: { execute(input: { sessionID: string }): Promise<void> } | undefined
  let handlers: { latest(input: Record<string, never>): Promise<{
    sequence: number
    sessionID: string
    ok: boolean
    path: string
    error: string
    lines?: string[]
  }> } | undefined
  let emitted = 0

  const registration = await registerMultiEndpointAudit({
    rpc: {
      register: async (_schema: unknown, nextHandlers: typeof handlers) => {
        const id = typeof _schema === "object" && _schema !== null ? (_schema as { id?: unknown }).id : undefined
        if (id !== "litellm-audit-export") {
          return {
            events: { emit: async () => {} },
            dispose: async () => {},
          }
        }
        handlers = nextHandlers
        return {
          events: { emit: async () => { emitted++ } },
          dispose: async () => {},
        }
      },
    },
    command: {
      transform: async (callback: (editor: {
        add(value: { name: string; execute(input: { sessionID: string }): Promise<void> }): void
      }) => void) => {
        callback({
          add(value) {
            if (value.name === "litellm-diagnostics") diagnostics = value
          },
        })
        return { dispose: async () => {} }
      },
    },
  } as never, ["default", "company"], () => ["default", "company"], new Map(), {
    writeFile: async () => "C:/unused.json",
  })

  try {
    expect(diagnostics).toBeDefined()
    expect(handlers).toBeDefined()

    await diagnostics!.execute({ sessionID: "session-1" })
    expect(emitted).toBe(1)

    const latest = await handlers!.latest({})
    expect(latest.sessionID).toBe("session-1")
    expect(latest.ok).toBeTrue()
    expect(latest.lines).toEqual([
      "LiteLLM Endpoints · active 2/2",
      "✓ default · pending · models=0",
      "✓ company · pending · models=0",
    ])
  } finally {
    await registration.dispose()
  }
})
