import type { LiteLLMAddresses } from "../core/litellm.js"

export type DiscoveryErrorKind =
  | "network"
  | "auth"
  | "notfound"
  | "ratelimit"
  | "server"
  | "parse"
  | "redirect"

export class DiscoveryError extends Error {
  constructor(
    readonly kind: DiscoveryErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = "DiscoveryError"
  }
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface FetchJSONOptions {
  url: string
  key?: string
  timeoutMs: number
  fetchImpl?: FetchLike
}

export interface CacheLogger {
  warn(message: string): void
}

const MODELS_DEV_URL = "https://models.dev/api.json"
const MODELS_DEV_TTL_MS = 6 * 60 * 60 * 1000
const MODELS_DEV_RETRY_MS = 60 * 1000

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function safeURL(raw: string): string {
  try {
    const url = new URL(raw)
    url.username = ""
    url.password = ""
    return url.toString()
  } catch {
    return raw.replace(/\/\/[^/@\s]+@/g, "//***@")
  }
}

export function redact(value: string, key?: string): string {
  let output = value
  if (key) output = output.replace(new RegExp(escapeRegExp(key), "g"), "sk-***")
  output = output.replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
  return output
}

function statusError(url: string, status: number, key?: string): DiscoveryError {
  const safe = redact(safeURL(url), key)
  if (status >= 300 && status < 400) {
    return new DiscoveryError("redirect", `请求 ${safe} 返回重定向状态 ${status}，请检查 LiteLLM 地址`, status)
  }
  if (status === 401 || status === 403) {
    return new DiscoveryError("auth", `请求 ${safe} 返回 ${status}：Key 无效或无权限`, status)
  }
  if (status === 404) return new DiscoveryError("notfound", `请求 ${safe} 返回 404`, status)
  if (status === 429) return new DiscoveryError("ratelimit", `请求 ${safe} 返回 429`, status)
  if (status >= 500) return new DiscoveryError("server", `请求 ${safe} 返回服务器错误 ${status}`, status)
  return new DiscoveryError("network", `请求 ${safe} 返回 HTTP ${status}`, status)
}

export async function fetchJSON(options: FetchJSONOptions): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs)
  const fetchImpl = options.fetchImpl ?? fetch

  try {
    const response = await fetchImpl(options.url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: options.key ? { Authorization: `Bearer ${options.key}` } : undefined,
    })
    if (!response.ok) throw statusError(options.url, response.status, options.key)

    try {
      return await response.json()
    } catch {
      throw new DiscoveryError(
        "parse",
        `请求 ${redact(safeURL(options.url), options.key)} 的响应不是有效 JSON`,
        response.status,
      )
    }
  } catch (error) {
    if (error instanceof DiscoveryError) throw error
    const timedOut = controller.signal.aborted
    const detail = error instanceof Error ? error.message : String(error)
    const reason = timedOut ? "请求超时" : redact(detail, options.key)
    throw new DiscoveryError(
      "network",
      `${reason}：${redact(safeURL(options.url), options.key)}`,
    )
  } finally {
    clearTimeout(timeout)
  }
}

export async function fetchLiteLLMModelInfo(
  addresses: LiteLLMAddresses,
  key: string,
  fetchImpl?: FetchLike,
): Promise<unknown> {
  try {
    return await fetchJSON({ url: addresses.modelInfoURL, key, timeoutMs: 15_000, fetchImpl })
  } catch (error) {
    if (!(error instanceof DiscoveryError) || error.kind !== "notfound") throw error
    return fetchJSON({ url: addresses.legacyModelInfoURL, key, timeoutMs: 15_000, fetchImpl })
  }
}

interface CatalogCache {
  value?: unknown
  expiresAt: number
  retryAt: number
  pending?: Promise<unknown>
}

const catalogCache: CatalogCache = { expiresAt: 0, retryAt: 0 }

export interface ModelsDevOptions {
  fetchImpl?: FetchLike
  now?: () => number
  logger?: CacheLogger
  url?: string
}

export async function getModelsDevCatalog(options: ModelsDevOptions = {}): Promise<unknown> {
  const now = options.now?.() ?? Date.now()
  if (catalogCache.value !== undefined && now < catalogCache.expiresAt) return catalogCache.value
  if (now < catalogCache.retryAt) return {}
  if (catalogCache.pending) return catalogCache.pending

  const request = fetchJSON({
    url: options.url ?? MODELS_DEV_URL,
    timeoutMs: 60_000,
    fetchImpl: options.fetchImpl,
  })
    .then((value) => {
      const completedAt = options.now?.() ?? Date.now()
      catalogCache.value = value
      catalogCache.expiresAt = completedAt + MODELS_DEV_TTL_MS
      catalogCache.retryAt = 0
      return value
    })
    .catch((error: unknown) => {
      const failedAt = options.now?.() ?? Date.now()
      catalogCache.value = undefined
      catalogCache.expiresAt = 0
      catalogCache.retryAt = failedAt + MODELS_DEV_RETRY_MS
      const message = error instanceof Error ? error.message : String(error)
      options.logger?.warn(`models.dev 获取失败，暂不补充模型元数据：${redact(message)}`)
      return {}
    })
    .finally(() => {
      catalogCache.pending = undefined
    })

  catalogCache.pending = request
  return request
}

export function resetModelsDevCacheForTest(): void {
  catalogCache.value = undefined
  catalogCache.expiresAt = 0
  catalogCache.retryAt = 0
  catalogCache.pending = undefined
}
