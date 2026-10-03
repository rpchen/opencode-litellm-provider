import { describe, expect, test } from "bun:test"
import type { ConnectionInfo } from "@opencode/client"
import type { ModelSpec } from "../src/core/build.js"
import { createDiscoverySnapshot, endpointFingerprint } from "../src/core/snapshot.js"
import { DiscoveryError } from "../src/net/fetch.js"
import { createDiagnosticsLines } from "../src/host/diagnostics.js"
import { createDiscoveryLoop, type Scheduler, type SyncContext } from "../src/host/sync.js"
import type { ProviderSnapshot } from "../src/host/register.js"
import type { PluginOptions } from "../src/options.js"
import { endpointIdentity, type EndpointIdentity } from "../src/endpoints.js"

class FakeScheduler implements Scheduler {
  tasks: Array<() => void> = []
  delays: number[] = []
  setTimeout(callback: () => void, milliseconds: number): unknown {
    this.tasks.push(callback)
    this.delays.push(milliseconds)
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

function harness(
  initialStorage?: unknown,
  useCoreDiagnostics = false,
  endpoint: EndpointIdentity = endpointIdentity("default", undefined, true),
) {
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
  let storageValue: unknown = initialStorage
  let storageWrites = 0
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
    storage: {
      get: async () => storageValue,
      set: async (_key, value) => {
        storageValue = value
        storageWrites += 1
      },
      remove: async () => {
        storageValue = undefined
        storageWrites += 1
      },
    },
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
    ...(useCoreDiagnostics ? {} : {
      buildModels: (response: unknown) => {
        const input = response as { model?: string; models?: string[] }
        if (input.models) return input.models.map(spec)
        return input.model === "empty" ? [] : [spec(input.model ?? "model-a")]
      },
    }),
  }, endpoint)

  return {
    loop,
    snapshot,
    scheduler,
    events,
    warnings,
    errors,
    get reloads() { return reloads },
    get fetches() { return fetches },
    get storageValue() { return storageValue },
    get storageWrites() { return storageWrites },
    setConnection(value: ConnectionInfo | undefined) { connection = value },
    setCredential(value: typeof credential) { credential = value },
    setFetch(value: () => Promise<unknown>) { nextFetch = value },
    setReload(value: () => Promise<void>) { nextReload = value },
  }
}

function persistedSnapshot(id: string, credentialKey = "sk-first", endpointID?: string) {
  const { package: _package, ...neutral } = spec(id)
  return createDiscoverySnapshot(
    endpointFingerprint({
      endpointID,
      baseUrl: "https://litellm.example",
      credentialKey,
      buildOptions: { contextTierCap: true, protocolOverrides: {} },
    }),
    [neutral],
    "2026-09-28T00:00:00.000Z",
  )
}

async function flush(): Promise<void> {
  // Storage restore adds asynchronous hops before network discovery/event-triggered work.
  for (let index = 0; index < 10; index += 1) await Promise.resolve()
}

describe("发现循环", () => {
  test("启动时先恢复 endpoint 兼容 snapshot，再用网络结果确认", async () => {
    const stored = JSON.stringify(persistedSnapshot("model-a"))
    const h = harness(stored)
    const pending = deferred<unknown>()
    h.setFetch(() => pending.promise)

    const starting = h.loop.start()
    await flush()
    expect(h.snapshot.models.map((model) => model.id)).toEqual(["model-a"])
    expect(h.snapshot.audit?.status).toBe("stale")
    expect(h.snapshot.audit?.lastSuccessfulDiscoveryAt).toBe("2026-09-28T00:00:00.000Z")
    expect(h.snapshot.diagnostics?.cache?.source).toBe("snapshot")
    expect(h.snapshot.diagnostics?.cache?.stale).toBeTrue()
    expect(h.snapshot.diagnostics?.note).toContain("等待网络确认")
    expect(h.reloads).toBe(1)

    pending.resolve({ model: "model-a" })
    await starting
    expect(h.snapshot.audit?.status).toBe("ready")
    expect(h.snapshot.diagnostics?.cache?.source).toBe("network")
    // The test fixture uses a synthetic host package, so the network-confirmed host
    // fingerprint differs from the package reconstructed from the neutral snapshot.
    expect(h.reloads).toBe(2)
    const persisted = JSON.parse(String(h.storageValue)) as { models: Array<Record<string, unknown>> }
    expect(persisted.models[0]?.package).toBeUndefined()
    await h.loop.dispose()
  })

  test("endpoint fingerprint 不匹配时不恢复旧 snapshot", async () => {
    const stored = JSON.stringify(persistedSnapshot("old-model", "sk-other"))
    const h = harness(stored)
    const pending = deferred<unknown>()
    h.setFetch(() => pending.promise)

    const starting = h.loop.start()
    await flush()
    expect(h.snapshot.ready).toBeFalse()
    expect(h.snapshot.models).toEqual([])
    expect(h.reloads).toBe(0)

    pending.resolve({ model: "model-a" })
    await starting
    expect(h.snapshot.models.map((model) => model.id)).toEqual(["model-a"])
    expect(h.storageWrites).toBe(1)
    await h.loop.dispose()
  })

  test("显式 endpoint identity 隔离同 URL/同凭据的 legacy snapshot", async () => {
    const stored = JSON.stringify(persistedSnapshot("legacy-model"))
    const endpoint = endpointIdentity("company", "https://litellm.example", false)
    const h = harness(stored, false, endpoint)
    const pending = deferred<unknown>()
    h.setFetch(() => pending.promise)

    const starting = h.loop.start()
    await flush()
    expect(h.snapshot.ready).toBeFalse()
    expect(h.snapshot.models).toEqual([])

    pending.resolve({ model: "company-model" })
    await starting
    const persisted = JSON.parse(String(h.storageValue)) as { endpointFingerprint: string }
    expect(persisted.endpointFingerprint).toBe(endpointFingerprint({
      endpointID: "company",
      baseUrl: "https://litellm.example",
      credentialKey: "sk-first",
      buildOptions: { contextTierCap: true, protocolOverrides: {} },
    }))
    await h.loop.dispose()
  })

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

    const beforeCachedRefresh = h.fetches
    await h.loop.trigger(false)
    expect(h.reloads).toBe(1)
    expect(h.fetches).toBe(beforeCachedRefresh)
    expect(h.snapshot.diagnostics?.cache?.source).toBe("memory-cache")
    expect(h.snapshot.audit?.lastSuccessfulDiscoveryAt).toBeTruthy()
    expect(h.snapshot.audit?.view).toBe(h.snapshot.registrationView)
    expect(Date.parse(h.snapshot.audit!.lastSuccessfulDiscoveryAt!)).toBeGreaterThanOrEqual(Date.parse(previousSuccess!))

    await h.loop.trigger(true)
    expect(h.fetches).toBe(beforeCachedRefresh + 1)
    expect(h.snapshot.diagnostics?.cache?.source).toBe("network")

    h.scheduler.runNext()
    await flush()
    expect(h.fetches).toBe(beforeCachedRefresh + 1)
    await h.loop.dispose()
  })

  test("production Core diagnostics and registered protocol stay aligned on conservative fallback", async () => {
    const h = harness(undefined, true)
    h.setFetch(async () => ({
      data: [
        {
          model_name: "mixed-model",
          litellm_params: { model: "openai/mixed-model" },
          model_info: {
            supported_endpoints: ["/v1/responses"],
            max_input_tokens: 100000,
            max_output_tokens: 10000,
            supports_function_calling: true,
            supports_reasoning: false,
            supports_vision: false,
            supports_pdf_input: false,
            supports_audio_input: false,
            supports_video_input: false,
            supports_audio_output: false,
          },
        },
        {
          model_name: "mixed-model",
          litellm_params: { model: "openai/mixed-model" },
          model_info: {
            supported_endpoints: ["/v1/chat/completions"],
            max_input_tokens: 100000,
            max_output_tokens: 10000,
            supports_function_calling: true,
            supports_reasoning: false,
            supports_vision: false,
            supports_pdf_input: false,
            supports_audio_input: false,
            supports_video_input: false,
            supports_audio_output: false,
          },
        },
      ],
    }))

    await h.loop.start()
    expect(h.snapshot.models).toHaveLength(1)
    expect(h.snapshot.models[0]?.protocol).toBe("chat")
    expect(h.snapshot.diagnostics?.discovery?.models[0]?.protocol).toMatchObject({
      value: "chat",
      reason: "mixed-fallback",
    })
    expect(h.snapshot.diagnostics?.discovery?.stats.protocolFallbacks).toBe(1)
    expect(h.snapshot.diagnostics?.discovery?.modelsDev.status).toBe("degraded")
    expect(h.snapshot.diagnostics?.cache?.source).toBe("network")
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

  test("退避窗口内的非强制刷新不重复请求", async () => {
    const h = harness()
    await h.loop.start()
    h.setFetch(async () => {
      throw new DiscoveryError("network", "offline")
    })
    await h.loop.trigger(true)
    const afterFailure = h.fetches
    expect(h.snapshot.audit?.status).toBe("stale")
    expect(h.snapshot.diagnostics?.cache?.source).toBe("stale")
    expect(h.snapshot.diagnostics?.cache?.stale).toBeTrue()
    expect(h.scheduler.delays.at(-1)).toBeGreaterThan(0)
    expect(h.scheduler.delays.at(-1)).toBeLessThanOrEqual(1_000)

    await h.loop.trigger(false)
    expect(h.fetches).toBe(afterFailure)
    expect(h.snapshot.audit?.status).toBe("stale")
    await h.loop.dispose()
  })

  test("网络类失败保留上次结果，认证失败清空", async () => {
    const h = harness()
    await h.loop.start()
    const successful = h.snapshot.audit?.lastSuccessfulDiscoveryAt
    const view = h.snapshot.audit?.view
    h.setFetch(async () => {
      throw new DiscoveryError("network", "offline sk-first https://private.example raw transport body")
    })
    await h.loop.trigger()
    expect(h.snapshot.models.map((model) => model.id)).toEqual(["model-a"])
    expect(h.snapshot.audit).toEqual({ status: "stale", view, lastSuccessfulDiscoveryAt: successful })
    expect(h.snapshot.diagnostics?.cache?.source).toBe("stale")
    const staleDiagnostics = createDiagnosticsLines(h.snapshot).join("\n")
    expect(staleDiagnostics).not.toContain("sk-first")
    expect(staleDiagnostics).not.toContain("private.example")
    expect(staleDiagnostics).not.toContain("raw transport body")
    expect(h.warnings[0]).not.toContain("sk-first")

    h.setFetch(async () => {
      throw new DiscoveryError("auth", "Key sk-first invalid", 401)
    })
    await h.loop.trigger()
    expect(h.snapshot.models).toEqual([])
    expect(h.snapshot.audit?.status).toBe("cleared-auth")
    expect(h.snapshot.diagnostics?.cache?.source).toBe("none")
    expect(h.snapshot.diagnostics?.note).toContain("认证失败")
    expect(createDiagnosticsLines(h.snapshot).join("\n")).not.toContain("sk-first")
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
