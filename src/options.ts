import { isEndpointID, type Protocol } from "./generated/discovery-core/index.js"
import { normalizeLiteLLMURL } from "./core/litellm.js"
import type { ValidationState } from "./host/endpoint-state.js"
export type { Protocol } from "./generated/discovery-core/index.js"

export interface EndpointDefinition {
  /** Raw user-provided baseUrl. Empty when invalid. */
  readonly baseUrl: string
  readonly protocolOverrides: Record<string, Protocol>
  /**
   * Endpoint definition validation. When absent (legacy callers/tests), the effective
   * value is `{ kind: "ok" }`. Runtime apply refuses the endpoint when `kind === "invalid"`.
   */
  readonly validation?: ValidationState
  /** The raw user value when validation failed (kept for diagnostics). */
  readonly invalidBaseUrl?: string
}

export interface PluginOptions {
  pollInterval: number
  contextTierCap: boolean
  protocolOverrides: Record<string, Protocol>
  conversationFeedback: boolean
  /**
   * Optional override for the models.dev catalog URL (default
   * `https://models.dev/catalog.json`). Lets an operator point at a self-hosted
   * or mirrored catalog snapshot; the mirror MUST serve the catalog shape
   * (`{ providers, models }`). Provider-only (`api.json` shape) mirrors are
   * classified by Core as providers-only: no canonical resolution runs, models
   * with complete LiteLLM declarations still publish, everything else is
   * withheld (valid LKG may still restore), and diagnostics suggest switching
   * to a catalog-shaped mirror. The fetched document goes through exactly the
   * same evidence and publication policy as the default source.
   */
  modelsDevUrl?: string
  /** Undefined means legacy single-endpoint mode using /connect URL caching. */
  endpoints?: Readonly<Record<string, EndpointDefinition>>
}

export interface OptionLogger {
  warn(message: string): void
}

export const DEFAULT_OPTIONS: PluginOptions = {
  pollInterval: 300,
  contextTierCap: true,
  protocolOverrides: {},
  conversationFeedback: false,
}

const PROTOCOLS = new Set<Protocol>(["chat", "responses", "messages"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isEndpointId(value: string): boolean {
  return isEndpointID(value)
}

function parseProtocolOverrides(value: unknown, label: string, logger: OptionLogger): Record<string, Protocol> {
  const protocolOverrides: Record<string, Protocol> = {}
  if (value === undefined) return protocolOverrides
  if (!isRecord(value)) {
    logger.warn(`${label} 必须是对象，已忽略`)
    return protocolOverrides
  }
  for (const [model, protocol] of Object.entries(value)) {
    if (model.length > 0 && typeof protocol === "string" && PROTOCOLS.has(protocol as Protocol)) {
      protocolOverrides[model] = protocol as Protocol
    } else {
      logger.warn(`${label}[${JSON.stringify(model)}] 无效，已忽略`)
    }
  }
  return protocolOverrides
}

export function parseOptions(input: unknown, logger: OptionLogger = console): PluginOptions {
  if (input === undefined) return { ...DEFAULT_OPTIONS, protocolOverrides: {} }
  if (!isRecord(input)) {
    logger.warn("LiteLLM 插件配置必须是对象，已使用默认值")
    return { ...DEFAULT_OPTIONS, protocolOverrides: {} }
  }

  let pollInterval = DEFAULT_OPTIONS.pollInterval
  if (input.pollInterval !== undefined) {
    if (typeof input.pollInterval !== "number" || !Number.isFinite(input.pollInterval) || input.pollInterval <= 0) {
      logger.warn("pollInterval 必须是正数，已使用默认值 300 秒")
    } else if (input.pollInterval < 30) {
      logger.warn("pollInterval 不能小于 30 秒，已钳制为 30 秒")
      pollInterval = 30
    } else {
      pollInterval = input.pollInterval
    }
  }

  let contextTierCap = DEFAULT_OPTIONS.contextTierCap
  if (input.contextTierCap !== undefined) {
    if (typeof input.contextTierCap === "boolean") contextTierCap = input.contextTierCap
    else logger.warn("contextTierCap 必须是布尔值，已使用默认值 true")
  }

  let conversationFeedback = DEFAULT_OPTIONS.conversationFeedback
  if (input.conversationFeedback !== undefined) {
    if (typeof input.conversationFeedback === "boolean") conversationFeedback = input.conversationFeedback
    else logger.warn("conversationFeedback 必须是布尔值，已使用默认值 false")
  }

  const protocolOverrides = parseProtocolOverrides(input.protocolOverrides, "protocolOverrides", logger)

  let endpoints: Record<string, EndpointDefinition> | undefined
  if (input.endpoints !== undefined) {
    endpoints = {}
    if (Object.keys(protocolOverrides).length > 0) {
      logger.warn("显式 endpoints 模式不能同时使用顶层 protocolOverrides；已拒绝 endpoint 配置")
      return { pollInterval, contextTierCap, protocolOverrides: {}, conversationFeedback, endpoints }
    }
    if (!isRecord(input.endpoints)) {
      logger.warn("endpoints 必须是对象；已拒绝显式 endpoint 配置")
      return { pollInterval, contextTierCap, protocolOverrides: {}, conversationFeedback, endpoints }
    }
    for (const [id, raw] of Object.entries(input.endpoints)) {
      if (!isEndpointId(id)) {
        logger.warn(`endpoint id ${JSON.stringify(id)} 非法（必须匹配 [a-z0-9][a-z0-9-_]*），已跳过`)
        continue
      }
      if (!isRecord(raw)) {
        logger.warn(`endpoint ${id} 必须是对象，已跳过`)
        continue
      }
      const rawUrl = typeof raw.baseUrl === "string" ? raw.baseUrl.trim() : ""
      // Use the same entry rule as runtime: normalizeLiteLLMURL rejects
      // non-http(s) AND userinfo-bearing URLs. No additional heuristics.
      let valid = false
      if (rawUrl.length > 0) {
        try {
          normalizeLiteLLMURL(rawUrl)
          valid = true
        } catch {}
      }
      if (!valid) {
        // Invalid endpoints are KEPT in the registry so the management UI and
        // diagnostics can show them as "Invalid configuration" instead of the
        // endpoint silently disappearing. Entries with no baseUrl at all are
        // still skipped (treated as "missing required field", not "invalid").
        if (rawUrl.length === 0) {
          logger.warn(`endpoint ${id} 缺少 baseUrl，已跳过`)
          continue
        }
        logger.warn(`endpoint ${id} 的 baseUrl 非法（${rawUrl.length > 0 ? "需为 http(s) 且不包含用户名/密码" : "缺失"}）；保留为 Invalid configuration`)
        endpoints[id] = {
          baseUrl: "",
          protocolOverrides: parseProtocolOverrides(raw.protocolOverrides, `endpoints.${id}.protocolOverrides`, logger),
          validation: { kind: "invalid", reason: "Base URL 非法（需要非空的 http(s) 地址，且不能包含用户名/密码）" },
          invalidBaseUrl: rawUrl,
        }
        continue
      }
      endpoints[id] = {
        baseUrl: rawUrl,
        protocolOverrides: parseProtocolOverrides(raw.protocolOverrides, `endpoints.${id}.protocolOverrides`, logger),
        validation: { kind: "ok" },
      }
    }
  }

  let modelsDevUrl: string | undefined
  if (input.modelsDevUrl !== undefined) {
    const raw = typeof input.modelsDevUrl === "string" ? input.modelsDevUrl.trim() : ""
    let valid = false
    if (raw.length > 0) {
      try {
        const url = new URL(raw)
        valid = (url.protocol === "http:" || url.protocol === "https:") && url.username === "" && url.password === ""
      } catch {}
    }
    if (valid) modelsDevUrl = raw
    else logger.warn("modelsDevUrl 必须是合法的 http(s) 地址且不含用户名/密码，已忽略（回退默认 models.dev）")
  }

  const parsed = modelsDevUrl === undefined
    ? { pollInterval, contextTierCap, protocolOverrides, conversationFeedback }
    : { pollInterval, contextTierCap, protocolOverrides, conversationFeedback, modelsDevUrl }
  return endpoints === undefined ? parsed : { ...parsed, endpoints }
}
