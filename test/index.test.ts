import { expect, test } from "bun:test"
import { Plugin } from "@opencode/plugin"
import plugin, { PLUGIN_ID, setupLiteLLM } from "../src/index.js"
import type { Scheduler } from "../src/host/sync.js"

class TestScheduler implements Scheduler {
  active: Array<() => void> = []
  all: Array<() => void> = []
  setTimeout(callback: () => void): unknown {
    this.active.push(callback)
    this.all.push(callback)
    return callback
  }
  clearTimeout(handle: unknown): void {
    this.active = this.active.filter((callback) => callback !== handle)
  }
}

test("默认导出符合 v2 Promise 插件形状", () => {
  expect(plugin.id).toBe(PLUGIN_ID)
  expect(typeof plugin.setup).toBe("function")
})

test("cleanup 停止发现并释放注册", async () => {
  const scheduler = new TestScheduler()
  let fetches = 0
  let disposed = 0
  const registration = { dispose: async () => { disposed += 1 } }
  const connection = { type: "credential" as const, id: "connection-1", label: "test", method: "key" as const }

  const context = {
    options: { pollInterval: 30 },
    integration: {
      transform: async (callback: (editor: unknown) => void) => {
        callback({
          update: (_id: string, update: (value: { id: string; name: string }) => void) =>
            update({ id: "litellm", name: "old" }),
          method: { update: () => {} },
        })
        return registration
      },
      connection: {
        active: async () => connection,
        resolve: async () => ({
          type: "key",
          key: "sk-test-only",
          configuration: { url: "https://litellm.example" },
        }),
      },
    },
    provider: {
      transform: async (callback: (editor: unknown) => void) => {
        callback({ add: () => {} })
        return registration
      },
      reload: async () => {},
    },
    rpc: { register: async () => ({ ...registration, events: { emit: async () => {} } }) },
    command: {
      transform: async (callback: (editor: { add: () => void }) => void) => {
        callback({ add: () => {} })
        return registration
      },
    },
    event: {
      subscribe: ({ signal }: { signal?: AbortSignal } = {}) => ({
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise<IteratorResult<never>>((resolve) => {
            signal?.addEventListener("abort", () => resolve({ value: undefined, done: true }), { once: true })
          }),
        }),
      }),
    },
  } as unknown as Plugin.Context

  const cleanup = await setupLiteLLM(context, {
    scheduler,
    fetchLiteLLM: async () => {
      fetches += 1
      return { data: [] }
    },
    getModelsDev: async () => ({}),
  })

  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  expect(fetches).toBe(1)
  const scheduled = scheduler.all[0]!

  await cleanup()
  expect(disposed).toBe(6)
  expect(scheduler.active).toHaveLength(0)

  scheduled()
  await Promise.resolve()
  expect(fetches).toBe(1)
})

test("显式多 endpoint 在单一 V2 plugin context 中启动并暴露独立 integration", async () => {
  const scheduler = new TestScheduler()
  const integrations = new Map<string, { id: string; name: string }>()
  const methods: Array<{ integrationID: string; method: unknown }> = []
  const activeCalls: string[] = []
  let disposed = 0
  let eventAborts = 0
  const registration = { dispose: async () => { disposed += 1 } }

  const context = {
    options: {
      pollInterval: 30,
      endpoints: {
        default: { baseUrl: "https://personal.example" },
        company: { baseUrl: "https://company.example" },
      },
    },
    integration: {
      transform: async (callback: (editor: unknown) => void) => {
        callback({
          update: (id: string, update: (value: { id: string; name: string }) => void) => {
            const value = integrations.get(id) ?? { id, name: id }
            update(value)
            integrations.set(id, value)
          },
          method: { update: (input: { integrationID: string; method: unknown }) => methods.push(input) },
        })
        return registration
      },
      connection: {
        active: async (integrationID: string) => {
          activeCalls.push(integrationID)
          return undefined
        },
        resolve: async () => undefined,
      },
    },
    provider: {
      transform: async (callback: (editor: unknown) => void) => {
        callback({ add: () => {} })
        return registration
      },
      reload: async () => {},
    },
    rpc: { register: async () => ({ ...registration, events: { emit: async () => {} } }) },
    command: {
      transform: async (callback: (editor: { add: () => void }) => void) => {
        callback({ add: () => {} })
        return registration
      },
    },
    event: {
      subscribe: ({ signal }: { signal?: AbortSignal } = {}) => ({
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise<IteratorResult<never>>((resolve) => {
            const finish = () => {
              eventAborts += 1
              resolve({ value: undefined, done: true })
            }
            if (signal?.aborted) finish()
            else signal?.addEventListener("abort", finish, { once: true })
          }),
        }),
      }),
    },
    storage: {
      get: async () => undefined,
      set: async () => {},
    },
    // Intentionally no context.plugin.add/remove: OpenCode V2 exposes only plugin.list().
  } as unknown as Plugin.Context

  const cleanup = await setupLiteLLM(context, { scheduler })
  await new Promise<void>((resolve) => setTimeout(resolve, 0))

  expect([...integrations.entries()]).toEqual([
    ["litellm", { id: "litellm", name: "LiteLLM" }],
    ["litellm-company", { id: "litellm-company", name: "LiteLLM · company" }],
  ])
  expect(methods.map((item) => item.integrationID)).toEqual(["litellm", "litellm-company"])
  expect(activeCalls).toEqual(expect.arrayContaining(["litellm", "litellm-company"]))

  await cleanup()
  expect(eventAborts).toBe(2)
  expect(disposed).toBe(7)
})
