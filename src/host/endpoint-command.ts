import type { Plugin } from "@opencode/plugin"
import type { EndpointActivation } from "../endpoints.js"
import { endpointRpc } from "./endpoint-rpc.js"
import type { Registration } from "./register.js"

export type EndpointViewItem = { id: string; baseUrl: string; active: boolean; legacy: boolean }

export type EndpointActivationView = {
  sequence: number
  sessionID: string
  mode: "all" | "selected"
  endpointIds: string[]
  activeEndpointIds: string[]
  endpoints?: EndpointViewItem[]
  writable?: boolean
  configProblem?: string
  legacyMigration?: boolean
}

export type MutationView = {
  ok: boolean
  code?: string
  message?: string
  migrated?: boolean
  /** The config mutation is persisted even though the operation failed (post-commit reload failure). */
  saved?: boolean
  state: EndpointActivationView
}

/** CRUD operations behind `/litellm-endpoints`; optional so pure-activation callers keep working. */
export interface EndpointManagement {
  endpoints(): EndpointViewItem[]
  writable(): { writable: boolean; problem?: string; legacyMigration: boolean }
  add(input: { endpointId: string; baseUrl: string; confirmMigration?: boolean }): Promise<Omit<MutationView, "state">>
  edit(input: { endpointId: string; baseUrl: string }): Promise<Omit<MutationView, "state">>
  prepareRemove(input: { endpointId: string }): Promise<Omit<MutationView, "state">>
  remove(input: { endpointId: string }): Promise<Omit<MutationView, "state">>
  /** Migrate the legacy single-endpoint configuration to explicit `endpoints.default` (no identity change). */
  migrate(): Promise<Omit<MutationView, "state">>
  /** Re-read the canonical config before each view so hand edits are visible. */
  refresh?(): Promise<void>
}

export async function registerEndpointActivation(
  context: Pick<Plugin.Context, "rpc" | "command">,
  endpointIds: readonly string[] | (() => readonly string[]),
  read: () => EndpointActivation,
  apply: (next: EndpointActivation) => Promise<void>,
  management?: EndpointManagement,
): Promise<Registration> {
  let sequence = 0
  let sessionID = ""
  let rpc: Awaited<ReturnType<typeof context.rpc.register<typeof endpointRpc>>>
  const ids = () => (typeof endpointIds === "function" ? [...endpointIds()] : [...endpointIds])

  const view = (): EndpointActivationView => {
    const activation = read()
    const all = ids()
    const selected = activation.mode === "all"
      ? all
      : all.filter((id) => activation.endpointIds.includes(id))
    const base: EndpointActivationView = {
      sequence,
      sessionID,
      mode: activation.mode,
      endpointIds: all,
      activeEndpointIds: selected,
    }
    if (!management) return base
    const state = management.writable()
    return {
      ...base,
      endpoints: management.endpoints(),
      writable: state.writable,
      ...(state.problem ? { configProblem: state.problem } : {}),
      legacyMigration: state.legacyMigration,
    }
  }

  const mutation = async (run: () => Promise<Omit<MutationView, "state">>): Promise<MutationView> => {
    if (!management) return { ok: false, code: "unsupported", message: "endpoint 管理不可用", state: view() }
    const outcome = await run()
    return { ...outcome, state: view() }
  }

  const show = async () => {
    await management?.refresh?.()
    sequence += 1
    const next = view()
    await rpc.events.emit("shown", next)
    return next
  }

  const handlers: Record<string, (input: unknown) => Promise<unknown>> = {
    async state() {
      await management?.refresh?.()
      return view()
    },
    async set(input: unknown) {
      const { action, endpointId } = input as { action: string; endpointId: string }
      const current = read()
      const all = ids()
      if (action === "all") {
        await apply({ mode: "all" })
      } else if (action === "none") {
        await apply({ mode: "selected", endpointIds: [] })
      } else if (action === "toggle" && all.includes(endpointId)) {
        const selected = new Set(current.mode === "all" ? all : current.endpointIds)
        if (selected.has(endpointId)) selected.delete(endpointId)
        else selected.add(endpointId)
        await apply({ mode: "selected", endpointIds: [...selected] })
      }
      // Mutating activation updates the selector's returned state, but it is not
      // a new request to open another selector. Keep the show sequence stable.
      return view()
    },
    add: (input: unknown) => mutation(() => management!.add(input as never)),
    edit: (input: unknown) => mutation(() => management!.edit(input as never)),
    prepareRemove: (input: unknown) => mutation(() => management!.prepareRemove(input as never)),
    remove: (input: unknown) => mutation(() => management!.remove(input as never)),
    migrate: () => mutation(() => management!.migrate()),
  }
  rpc = await context.rpc.register(endpointRpc, handlers as never)

  try {
    const command = await context.command.transform((editor) => {
      editor.add({
        name: "litellm-endpoints",
        description: "管理全局 LiteLLM endpoint：新增、修改、删除、启用/停用、凭据",
        async execute(input) {
          sessionID = input.sessionID
          await show()
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
