import { expect, test } from "bun:test"
import type { EndpointActivation } from "../src/endpoints.js"
import {
  registerEndpointActivation,
  type EndpointActivationView,
} from "../src/host/endpoint-command.js"

test("endpoint set 更新 activation 但不重放 shown；下一次命令才产生新 show sequence", async () => {
  let activation: EndpointActivation = { mode: "all" }
  let command: { execute(input: { sessionID: string }): Promise<void> } | undefined
  let handlers: {
    state(): Promise<EndpointActivationView>
    set(input: { action: string; endpointId: string }): Promise<EndpointActivationView>
  } | undefined
  const shown: EndpointActivationView[] = []
  let disposed = 0

  const registration = await registerEndpointActivation({
    rpc: {
      register: async (_schema: unknown, nextHandlers: typeof handlers) => {
        handlers = nextHandlers
        return {
          events: {
            emit: async (_event: string, value: EndpointActivationView) => {
              shown.push(structuredClone(value))
            },
          },
          dispose: async () => { disposed++ },
        }
      },
    },
    command: {
      transform: async (callback: (editor: {
        add(value: { name: string; execute(input: { sessionID: string }): Promise<void> }): void
      }) => void) => {
        callback({
          add(value) {
            if (value.name === "litellm-endpoints") command = value
          },
        })
        return { dispose: async () => { disposed++ } }
      },
    },
  } as never, ["default", "company"], () => activation, async (next) => {
    activation = next
  })

  try {
    expect(command).toBeDefined()
    expect(handlers).toBeDefined()

    await command!.execute({ sessionID: "session-1" })
    expect(shown).toHaveLength(1)
    expect(shown[0]).toMatchObject({
      sequence: 1,
      sessionID: "session-1",
      activeEndpointIds: ["default", "company"],
    })

    const toggled = await handlers!.set({ action: "toggle", endpointId: "default" })
    expect(toggled).toMatchObject({
      sequence: 1,
      sessionID: "session-1",
      mode: "selected",
      activeEndpointIds: ["company"],
    })
    expect(shown).toHaveLength(1)
    expect(await handlers!.state()).toEqual(toggled)

    await command!.execute({ sessionID: "session-1" })
    expect(shown).toHaveLength(2)
    expect(shown[1]?.sequence).toBe(2)
    expect(shown[1]?.activeEndpointIds).toEqual(["company"])
  } finally {
    await registration.dispose()
  }

  expect(disposed).toBe(2)
})
