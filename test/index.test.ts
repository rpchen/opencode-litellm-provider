import { expect, test } from "bun:test"
import { Plugin } from "@opencode/plugin"
import plugin, { PLUGIN_ID, setupLiteLLM } from "../src/index.js"
import { createAuditReport } from "../src/host/audit.js"
import { createDiagnosticsLines } from "../src/host/diagnostics.js"
import { getRuntimeIdentity, resetRuntimeIdentityForTests, setRuntimeIdentityForTests } from "../src/host/runtime-identity.js"
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

test("startup log uses the canonical Runtime Identity [STARTUP-LOG] [CANONICAL-SINGLE]", async () => {
  resetRuntimeIdentityForTests()
  setRuntimeIdentityForTests({
    pluginVersion: "0.5.0",
    artifactDigest: `sha256:${"b".repeat(64)}`,
    coreCommit: "8e155e0efe90f1e9e7c8e973239c206a97011477",
  })
  try {
    const lines: string[] = []
    const logger = { info: (line: string) => { lines.push(line) }, log: (line: string) => { lines.push(line) } }
    const scheduler = new TestScheduler()
    const registration = { dispose: async () => {} }
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
          active: async () => undefined,
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
        subscribe: () => ({
          [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<never>>(() => {}) }),
        }),
      },
    } as unknown as Plugin.Context
    const cleanup = await setupLiteLLM(context, { scheduler }, { logger })
    const identity = getRuntimeIdentity()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(`plugin=${identity.pluginVersion}`)
    expect(lines[0]).toContain("artifact=bbbbbbbb")
    expect(lines[0]).toContain("core=8e155e0e")
    // Same canonical source as diagnostics and audit.
    const diagnosticsText = createDiagnosticsLines({ ready: false, models: [], audit: { status: "disconnected" } }).join("\n")
    expect(diagnosticsText).toContain(`Plugin Version   ${identity.pluginVersion}`)
    const audit = createAuditReport({ status: "disconnected" }) as { runtimeIdentity: unknown }
    expect(audit.runtimeIdentity).toEqual({
      pluginVersion: identity.pluginVersion,
      artifactDigest: identity.artifactDigest,
      coreCommit: identity.coreCommit,
    })
    await cleanup()
  } finally {
    resetRuntimeIdentityForTests()
  }
})

test("runtime identity has no builtAt and no git dependency [OUT-OF-SCOPE] [IDENTITY-NO-GIT]", async () => {
  const { readFileSync, existsSync } = await import("node:fs")
  const { fileURLToPath } = await import("node:url")
  const path = await import("node:path")
  const testDir = path.dirname(fileURLToPath(import.meta.url))
  // Source-level guard: always available, including in isolated build roots.
  const source = readFileSync(path.join(testDir, "..", "src", "host", "runtime-identity.ts"), "utf8")
  expect(source).not.toContain("child_process")
  expect(source).not.toContain("rev-parse")
  expect(source).not.toContain(".git")
  expect(source).not.toContain("builtAt")
  // Candidate artifact guard when the committed dist is present (skipped in
  // isolated build roots where dist is compiled after unit tests).
  const identityPath = path.join(testDir, "..", "dist", "runtime-identity.json")
  if (existsSync(identityPath)) {
    const identityRaw = readFileSync(identityPath, "utf8")
    expect(identityRaw).not.toContain("builtAt")
    expect(identityRaw).not.toContain("pluginCommit")
  }
})
