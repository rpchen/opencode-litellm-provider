import type { ConnectionInfo } from "@opencode/client"
import type { ModelSpec } from "../core/build.js"
import { buildModelSpecs, modelFingerprint } from "../core/build.js"
import { normalizeLiteLLMURL } from "../core/litellm.js"
import type { PluginOptions } from "../options.js"
import {
  DiscoveryError,
  fetchLiteLLMModelInfo,
  getModelsDevCatalog,
  redact,
  type FetchLike,
} from "../net/fetch.js"
import { INTEGRATION_ID, type ProviderSnapshot } from "./register.js"

interface KeyCredential {
  type: "key"
  key: string
  configuration?: Record<string, string | number | boolean | string[]>
}

interface EventLike {
  type: string
  data?: unknown
}

export interface SyncContext {
  integration: {
    connection: {
      active(integrationID: string): Promise<ConnectionInfo | undefined>
      resolve(connection: ConnectionInfo): Promise<unknown>
    }
  }
  provider: {
    reload(): Promise<void>
  }
  event: {
    subscribe(options?: { signal?: AbortSignal }): AsyncIterable<EventLike>
  }
}

export interface SyncLogger {
  warn(message: string): void
  error(message: string): void
}

export interface Scheduler {
  setTimeout(callback: () => void, milliseconds: number): unknown
  clearTimeout(handle: unknown): void
}

export interface DiscoveryDependencies {
  fetchImpl?: FetchLike
  fetchLiteLLM?: typeof fetchLiteLLMModelInfo
  getModelsDev?: typeof getModelsDevCatalog
  buildModels?: typeof buildModelSpecs
  fingerprint?: typeof modelFingerprint
  logger?: SyncLogger
  scheduler?: Scheduler
}

export interface DiscoveryLoop {
  start(): Promise<void>
  trigger(): Promise<void>
  dispose(): Promise<void>
}

const defaultScheduler: Scheduler = {
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

function isKeyCredential(value: unknown): value is KeyCredential {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "key" &&
    typeof (value as { key?: unknown }).key === "string"
}

function switchedForLiteLLM(event: EventLike): boolean {
  if (event.type === "credential.updated") return true
  if (event.type !== "credential.switched" || typeof event.data !== "object" || event.data === null) return false
  return (event.data as { integrationID?: unknown }).integrationID === INTEGRATION_ID
}

function connectionIdentity(connection: ConnectionInfo, credential: KeyCredential, url: string): string {
  const connectionID = connection.type === "credential" ? connection.id : connection.name
  return `${connection.type}\u0000${connectionID}\u0000${url}\u0000${credential.key}`
}

export function createDiscoveryLoop(
  context: SyncContext,
  snapshot: ProviderSnapshot,
  options: PluginOptions,
  dependencies: DiscoveryDependencies = {},
): DiscoveryLoop {
  const scheduler = dependencies.scheduler ?? defaultScheduler
  const logger = dependencies.logger ?? console
  const fetchModelInfo = dependencies.fetchLiteLLM ?? fetchLiteLLMModelInfo
  const fetchCatalog = dependencies.getModelsDev ?? getModelsDevCatalog
  const buildModels = dependencies.buildModels ?? buildModelSpecs
  const fingerprint = dependencies.fingerprint ?? modelFingerprint
  const abortEvents = new AbortController()

  let timer: unknown
  let disposed = false
  let running: Promise<void> | undefined
  let queued = false
  let identity: string | undefined
  let lastFingerprint: string | undefined
  let eventTask: Promise<void> | undefined

  const cancelTimer = () => {
    if (timer !== undefined) scheduler.clearTimeout(timer)
    timer = undefined
  }

  const schedule = () => {
    cancelTimer()
    if (disposed || !snapshot.connection) return
    timer = scheduler.setTimeout(() => {
      timer = undefined
      void trigger()
    }, options.pollInterval * 1000)
  }

  const removeProvider = async () => {
    const hadRegistration = snapshot.ready && snapshot.connection !== undefined
    snapshot.ready = false
    snapshot.connection = undefined
    snapshot.apiBaseURL = undefined
    snapshot.models = []
    identity = undefined
    lastFingerprint = undefined
    if (hadRegistration) await context.provider.reload()
  }

  const clearModels = async (connection: ConnectionInfo, apiBaseURL: string) => {
    const emptyFingerprint = fingerprint([])
    const changed = !snapshot.ready || lastFingerprint !== emptyFingerprint
    snapshot.ready = true
    snapshot.connection = connection
    snapshot.apiBaseURL = apiBaseURL
    snapshot.models = []
    lastFingerprint = emptyFingerprint
    if (changed) await context.provider.reload()
  }

  const refreshOnce = async () => {
    const connection = await context.integration.connection.active(INTEGRATION_ID)
    if (!connection) {
      cancelTimer()
      await removeProvider()
      return
    }

    const resolved = await context.integration.connection.resolve(connection)
    if (!isKeyCredential(resolved)) {
      logger.error("LiteLLM 活动连接没有可用的 API Key")
      await removeProvider()
      return
    }

    const rawURL = resolved.configuration?.url
    if (typeof rawURL !== "string" || rawURL.length === 0) {
      logger.error("LiteLLM 活动连接缺少必填地址")
      await removeProvider()
      return
    }

    let addresses
    try {
      addresses = normalizeLiteLLMURL(rawURL)
    } catch (error) {
      logger.error(error instanceof Error ? error.message : "LiteLLM 地址无效")
      await removeProvider()
      return
    }

    const nextIdentity = connectionIdentity(connection, resolved, addresses.rootURL)
    const connectionChanged = identity !== undefined && identity !== nextIdentity
    if (connectionChanged) {
      const hadRegistration = snapshot.ready
      snapshot.ready = false
      snapshot.connection = connection
      snapshot.apiBaseURL = addresses.apiBaseURL
      snapshot.models = []
      lastFingerprint = undefined
      if (hadRegistration) await context.provider.reload()
    }
    identity = nextIdentity

    try {
      const response = await fetchModelInfo(addresses, resolved.key, dependencies.fetchImpl)
      const catalog = await fetchCatalog({
        fetchImpl: dependencies.fetchImpl,
        logger,
      })
      if (disposed || identity !== nextIdentity) return

      const models = buildModels(response, catalog, options)
      const nextFingerprint = fingerprint(models)
      const changed = !snapshot.ready || lastFingerprint !== nextFingerprint
      snapshot.ready = true
      snapshot.connection = connection
      snapshot.apiBaseURL = addresses.apiBaseURL
      snapshot.models = models
      lastFingerprint = nextFingerprint
      if (changed) await context.provider.reload()
    } catch (error) {
      if (disposed || identity !== nextIdentity) return
      if (error instanceof DiscoveryError && (error.kind === "auth" || error.kind === "notfound")) {
        logger.error(redact(error.message, resolved.key))
        await clearModels(connection, addresses.apiBaseURL)
      } else {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(`LiteLLM 发现失败，保留上次结果：${redact(message, resolved.key)}`)
      }
    } finally {
      schedule()
    }
  }

  const trigger = (): Promise<void> => {
    if (disposed) return Promise.resolve()
    if (running) {
      queued = true
      return running
    }

    running = (async () => {
      do {
        queued = false
        try {
          await refreshOnce()
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          logger.warn(`LiteLLM 发现循环出错，将在下个周期重试：${redact(message)}`)
          schedule()
        }
      } while (queued && !disposed)
    })().finally(() => {
      running = undefined
    })
    return running
  }

  const listen = async () => {
    try {
      for await (const event of context.event.subscribe({ signal: abortEvents.signal })) {
        if (disposed) break
        if (switchedForLiteLLM(event)) {
          cancelTimer()
          void trigger()
        }
      }
    } catch (error) {
      if (!disposed) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(`LiteLLM 连接事件订阅已停止，将依靠轮询：${redact(message)}`)
      }
    }
  }

  return {
    async start() {
      if (disposed) return
      eventTask = listen()
      await trigger()
    },
    trigger,
    async dispose() {
      if (disposed) return
      disposed = true
      cancelTimer()
      abortEvents.abort()
      await running
      void eventTask
    },
  }
}
