export type Protocol = "chat" | "responses" | "messages"

export interface PluginOptions {
  pollInterval: number
  contextTierCap: boolean
  protocolOverrides: Record<string, Protocol>
}

export interface OptionLogger {
  warn(message: string): void
}

export const DEFAULT_OPTIONS: PluginOptions = {
  pollInterval: 300,
  contextTierCap: true,
  protocolOverrides: {},
}

const PROTOCOLS = new Set<Protocol>(["chat", "responses", "messages"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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

  const protocolOverrides: Record<string, Protocol> = {}
  if (input.protocolOverrides !== undefined) {
    if (!isRecord(input.protocolOverrides)) {
      logger.warn("protocolOverrides 必须是对象，已忽略")
    } else {
      for (const [model, protocol] of Object.entries(input.protocolOverrides)) {
        if (model.length > 0 && typeof protocol === "string" && PROTOCOLS.has(protocol as Protocol)) {
          protocolOverrides[model] = protocol as Protocol
        } else {
          logger.warn(`protocolOverrides[${JSON.stringify(model)}] 无效，已忽略`)
        }
      }
    }
  }

  return { pollInterval, contextTierCap, protocolOverrides }
}
