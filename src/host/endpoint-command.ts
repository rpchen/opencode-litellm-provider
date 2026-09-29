import type { Plugin } from "@opencode/plugin"
import type { EndpointActivation } from "../endpoints.js"
import { endpointRpc } from "./endpoint-rpc.js"
import type { Registration } from "./register.js"

export interface EndpointActivationView {
  sequence: number
  sessionID: string
  mode: "all" | "selected"
  endpointIds: string[]
  activeEndpointIds: string[]
}

export async function registerEndpointActivation(
  context: Pick<Plugin.Context, "rpc" | "command">,
  endpointIds: readonly string[],
  read: () => EndpointActivation,
  apply: (next: EndpointActivation) => Promise<void>,
): Promise<Registration> {
  let sequence = 0
  let sessionID = ""
  let rpc: Awaited<ReturnType<typeof context.rpc.register<typeof endpointRpc>>>

  const view = (): EndpointActivationView => {
    const activation = read()
    const selected = activation.mode === "all"
      ? [...endpointIds]
      : endpointIds.filter((id) => activation.endpointIds.includes(id))
    return {
      sequence,
      sessionID,
      mode: activation.mode,
      endpointIds: [...endpointIds],
      activeEndpointIds: selected,
    }
  }

  const emit = async () => {
    const next = { ...view(), sequence: ++sequence }
    await rpc.events.emit("shown", next)
    return next
  }

  rpc = await context.rpc.register(endpointRpc, {
    async state() {
      return view()
    },
    async set(input) {
      const { action, endpointId } = input as { action: string; endpointId: string }
      const current = read()
      if (action === "all") {
        await apply({ mode: "all" })
      } else if (action === "none") {
        await apply({ mode: "selected", endpointIds: [] })
      } else if (action === "toggle" && endpointIds.includes(endpointId)) {
        const selected = new Set(current.mode === "all" ? endpointIds : current.endpointIds)
        if (selected.has(endpointId)) selected.delete(endpointId)
        else selected.add(endpointId)
        await apply({ mode: "selected", endpointIds: [...selected] })
      }
      return emit()
    },
  })

  try {
    const command = await context.command.transform((editor) => {
      editor.add({
        name: "litellm-endpoints",
        description: "管理全局 LiteLLM endpoint activation",
        async execute(input) {
          sessionID = input.sessionID
          await emit()
        },
      })
    })
    return {
      async dispose() {
        await command.dispose()
        await rpc.dispose()
      },
    }
  } catch (error) {
    await rpc.dispose()
    throw error
  }
}
