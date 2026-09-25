import { describe, expect, test } from "bun:test"
import type { ConnectionInfo } from "@opencode/client"
import type { ModelSpec } from "../src/core/build.js"
import { DiscoveryError } from "../src/net/fetch.js"
import { createDiscoveryLoop, type Scheduler, type SyncContext } from "../src/host/sync.js"
import type { ProviderSnapshot } from "../src/host/register.js"
import type { PluginOptions } from "../src/options.js"

class FakeScheduler implements Scheduler {
  tasks: Array<() => void> = []
  setTimeout(callback: () => void): unknown {
    this.tasks.push(callback)
    return callback
  }
  clearTimeout(handle: unknown): void {
    this.tasks = this.tasks.filter((callback) => callback !== handle)
  }
  runNext(): void {
    this.tasks.shift()?.()
  }
}

class EventQueue {
  private values: Array<{ type: string; data?: unknown }> = []
  private waiters: Array<(value: IteratorResult<{ type: string; data?: unknown }>) => void> = []

  push(value: { type: string; data?: unknown }): void {
    const waiter = this.waiters.shift()
    if (waiter) waiter({ value, done: false })
    else this.values.push(value)
  }

  iterable(signal?: AbortSignal): AsyncIterable<{ type: string; data?: unknown }> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          const value = this.values.shift()
          if (value) return Promise.resolve({ value, done: false })
          if (signal?.aborted) return Promise.resolve({ value: undefined, done: true })
          return new Promise((resolve) => {
            const complete = () => resolve({ value: undefined, done: true })
            signal?.addEventListener("abort", complete, { once: true })
            this.waiters.push(resolve)
          })
        },
      }),
    }
  }
}

function spec(id: string): ModelSpec {
  return {
    id,
    name: id,
    protocol: "chat",
    package: "chat-package",
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: [],
    released: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    limit: { context: 100, input: 100, output: 10 },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}

function harness() {
  const scheduler = new FakeScheduler()
  const events = new EventQueue()
  const connectionA: ConnectionInfo = {
    type: "credential",
    id: "credential-a",
    label: "A",
    method: "key",
  }
  let connection: ConnectionInfo | undefined = connectionA
  let credential = {
    type: "key" as const,
    key: "sk-first",
    configuration: { url: "https://litellm.example" },
  }
  let reloads = 0
  let nextReload: () => Promise<void> = async () => {}
  let fetches = 0
  let nextFetch: () => Promise<unknown> = async () => ({ model: "model-a" })
  const warnings: string[] = []
  const errors: string[] = []
  const context: SyncContext = {
    integration: {
      connection: {
        active: async () => connection,
        resolve: async () => credential,
      },
    },
    provider: {
      reload: async () => {
        reloads += 1
        await nextReload()
      },
    },
    event: { subscribe: ({ signal } = {}) => events.iterable(signal) },
  }
  const snapshot: ProviderSnapshot = { ready: false, models: [] }
  const options: PluginOptions = {
    pollInterval: 30,
    contextTierCap: true,
    protocolOverrides: {},
    conversationFeedback: false,
  }
  const loop = createDiscoveryLoop(context, snapshot, options, {
    scheduler,
    logger: { warn: (message) => warnings.push(message), error: (message) => errors.push(message) },
    fetchLiteLLM: async () => {
      fetches += 1
      return nextFetch()
    },
    getModelsDev: async () => ({}),
    buildModels: (response) => {
      const input = response as { model?: string; models?: string[] }
      if (input.models) return input.models.map(spec)
      return input.model === "empty" ? [] : [spec(input.model ?? "model-a")]
    },
  })

  return {
    loop,
    snapshot,
    scheduler,
    events,
    warnings,
    errors,
    get reloads() { return reloads },
    get fetches() { return fetches },
    setConnection(value: ConnectionInfo | undefined) { connection = value },
    setCredential(value: typeof credential) { credential = value },
    setFetch(value: () => Promise<unknown>) { nextFetch = value },
    setReload(value: () => Promise<void>) { nextReload = value },
  }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe("发现循环", () => {
  test("启动发现、稳定指纹不重复 reload、轮询继续发现", async () => {
    const h = harness()
    await h.loop.start()
    expect(h.snapshot.models.map((model) => model.id)).toEqual(["model-a"])
    expect(h.snapshot.audit?.status).toBe("ready")
    expect(h.snapshot.audit?.view).toBe(h.snapshot.registrationView)
    expect(h.snapshot.audit?.lastSuccessfulDiscoveryAt).toBeTruthy()
    const previousSuccess = h.snapshot.audit?.lastSuccessfulDiscoveryAt
    expect(h.reloads).toBe(1)
    expect(h.scheduler.tasks).toHaveLength(1)

    await h.loop.trigger()
    expect(h.reloads).toBe(1)
    expect(h.snapshot.audit?.lastSuccessfulDiscoveryAt).toBeTruthy()
    expect(h.snapshot.audit?.view).toBe(h.snapshot.registrationView)
    expect(Date.parse(h.snapshot.audit!.lastSuccessfulDiscoveryAt!)).toBeGreaterThanOrEqual(Date.parse(previousSuccess!))
    h.scheduler.runNext()
    await flush()
    expect(h.fetches).toBe(3)
    await h.loop.dispose()
  })

  test("轮询发现模型新增和删除后整体刷新", async () => {
    const h = harness()
    await h.loop.start()

    h.setFetch(async () => ({ models: ["model-a", "model-b"] }))
    h.scheduler.runNext()
    await h.loop.trigger()
    expect(h.snapshot.models.map((model) => model.id)).toEqual(["model-a", "model-b"])
    expect(h.reloads).toBe(2)

    h.setFetch(async () => ({ models: ["model-b"] }))
    h.scheduler.runNext()
    await h.loop.trigger()
    expect(h.snapshot.models.map((model) => model.id)).toEqual(["model-b"])
    expect(h.reloads).toBe(3)
    await h.loop.dispose()
  })

  test("网络类失败保留上次结果，认证失败清空", async () => {
    const h = harness()
    await h.loop.start()
    const successful = h.snapshot.audit?.lastSuccessfulDiscoveryAt
    const view = h.snapshot.audit?.view
    h.setFetch(async () => {
      throw new DiscoveryError("network", "offline sk-first")
    })
    await h.loop.trigger()
    expect(h.snapshot.models.map((model) => model.id)).toEqual(["model-a"])
    expect(h.snapshot.audit).toEqual({ status: "stale", view, lastSuccessfulDiscoveryAt: successful })
    expect(h.warnings[0]).not.toContain("sk-first")

    h.setFetch(async () => {
      throw new DiscoveryError("auth", "Key sk-first invalid", 401)
    })
    await h.loop.trigger()
    expect(h.snapshot.models).toEqual([])
    expect(h.snapshot.audit?.status).toBe("cleared-auth")
    expect(h.snapshot.audit?.view).toBeUndefined()
    expect(h.snapshot.audit?.lastSuccessfulDiscoveryAt).toBeUndefined()
    expect(h.reloads).toBe(2)
    expect(h.errors[0]).not.toContain("sk-first")
    await h.loop.dispose()
  })

  test("换连接时先隐藏旧结果，新结果完成后再注册", async () => {
    const h = harness()
    await h.loop.start()
    const pending = deferred<unknown>()
    h.setConnection({ type: "credential", id: "credential-b", label: "B", method: "key" })
    h.setCredential({
      type: "key",
      key: "sk-second",
      configuration: { url: "https://second.example/v1" },
    })
    h.setFetch(() => pending.promise)

    const refresh = h.loop.trigger()
    await flush()
    expect(h.snapshot.ready).toBeFalse()
    expect(h.snapshot.models).toEqual([])
    expect(h.snapshot.audit).toEqual({ status: "switching" })
    expect(h.reloads).toBe(2)

    pending.resolve({ model: "model-b" })
    await refresh
    expect(h.snapshot.models.map((model) => model.id)).toEqual(["model-b"])
    expect(h.snapshot.apiBaseURL).toBe("https://second.example/v1")
    expect(h.snapshot.audit?.status).toBe("ready")
    expect(h.snapshot.audit?.view?.models.map((item) => String(item.id))).toEqual(["model-b"])
    expect(h.reloads).toBe(3)
    await h.loop.dispose()
  })

  test("断开连接撤下模型、停止轮询且不再请求", async () => {
    const h = harness()
    await h.loop.start()
    const before = h.fetches
    h.setConnection(undefined)
    await h.loop.trigger()
    expect(h.snapshot.ready).toBeFalse()
    expect(h.snapshot.connection).toBeUndefined()
    expect(h.snapshot.audit).toEqual({ status: "disconnected" })
    expect(h.scheduler.tasks).toHaveLength(0)
    expect(h.fetches).toBe(before)
    expect(h.reloads).toBe(2)
    await h.loop.dispose()
  })

  test("断开时 reload 失败后继续调度重试撤销注册", async () => {
    const h = harness()
    await h.loop.start()
    h.setConnection(undefined)
    h.setReload(async () => { throw new Error("temporary reload failure") })
    await h.loop.trigger()
    expect(h.snapshot.audit).toEqual({ status: "disconnected" })
    expect(h.scheduler.tasks).toHaveLength(1)
    h.setReload(async () => {})
    h.scheduler.runNext()
    await h.loop.trigger()
    expect(h.reloads).toBe(3)
    expect(h.scheduler.tasks).toHaveLength(0)
    await h.loop.dispose()
  })

  test("credential.switched 与 credential.updated 触发复核", async () => {
    const h = harness()
    await h.loop.start()
    const before = h.fetches
    h.events.push({ type: "credential.switched", data: { integrationID: "other" } })
    await flush()
    expect(h.fetches).toBe(before)

    h.events.push({ type: "credential.updated", data: {} })
    await flush()
    expect(h.fetches).toBe(before + 1)
    await h.loop.dispose()
  })

  test("并发触发合并为当前发现后的一次补充发现", async () => {
    const h = harness()
    const first = deferred<unknown>()
    h.setFetch(() => first.promise)
    const starting = h.loop.start()
    const second = h.loop.trigger()
    const third = h.loop.trigger()
    await flush()
    expect(h.fetches).toBe(1)
    expect(h.snapshot.ready).toBeFalse()
    expect(h.snapshot.audit?.status).toBe("pending")
    expect(h.snapshot.audit?.view).toBeUndefined()
    first.resolve({ model: "model-a" })
    h.setFetch(async () => ({ model: "model-a" }))
    await Promise.all([starting, second, third])
    expect(h.fetches).toBe(2)
    await h.loop.dispose()
  })

  test("reload 失败不标记成功发现，同指纹后续重试注册", async () => {
    const h = harness()
    await h.loop.start()
    const previous = h.snapshot.audit
    h.setFetch(async () => ({ model: "model-b" }))
    h.setReload(async () => { throw new Error("temporary reload failure") })
    await h.loop.trigger()
    expect(h.snapshot.audit?.view).toBe(previous?.view)
    expect(h.snapshot.audit?.lastSuccessfulDiscoveryAt).toBe(previous?.lastSuccessfulDiscoveryAt)
    expect(h.reloads).toBe(2)
    h.setReload(async () => {})
    await h.loop.trigger()
    expect(h.reloads).toBe(3)
    expect(h.snapshot.audit?.status).toBe("ready")
    expect(h.snapshot.audit?.view?.models.map((item) => String(item.id))).toEqual(["model-b"])
    await h.loop.dispose()
  })

  test("接口不存在清除可用视图且标记原因", async () => {
    const h = harness()
    await h.loop.start()
    h.setFetch(async () => { throw new DiscoveryError("notfound", "missing", 404) })
    await h.loop.trigger()
    expect(h.snapshot.audit).toEqual({ status: "cleared-notfound" })
    expect(h.snapshot.registrationView?.models).toEqual([])
    expect(h.reloads).toBe(2)
    await h.loop.dispose()
  })

  test("认证失败后的网络错误不会恢复旧视图或伪造成功时间", async () => {
    const h = harness()
    await h.loop.start()
    h.setFetch(async () => { throw new DiscoveryError("auth", "bad", 403) })
    await h.loop.trigger()
    h.setFetch(async () => { throw new DiscoveryError("network", "offline") })
    await h.loop.trigger()
    expect(h.snapshot.audit).toEqual({ status: "cleared-auth" })
    expect(h.snapshot.registrationView?.models).toEqual([])
    expect(h.reloads).toBe(2)
    await h.loop.dispose()
  })

  test("成功空清单会撤下旧模型", async () => {
    const h = harness()
    await h.loop.start()
    h.setFetch(async () => ({ model: "empty" }))
    await h.loop.trigger()
    expect(h.snapshot.models).toEqual([])
    expect(h.snapshot.audit?.status).toBe("empty")
    expect(h.snapshot.audit?.view?.models).toEqual([])
    expect(h.snapshot.audit?.lastSuccessfulDiscoveryAt).toBeTruthy()
    await h.loop.dispose()
  })
})
