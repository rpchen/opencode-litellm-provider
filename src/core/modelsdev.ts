import type { Protocol } from "../options.js"
import {
  isRecord,
  optionalNumber,
  optionalString,
  stripRoutePrefix,
  type DeploymentGroup,
} from "./litellm.js"

export interface ModelsDevRecord extends Record<string, unknown> {
  id?: unknown
  name?: unknown
  release_date?: unknown
  modalities?: unknown
  limit?: unknown
  cost?: unknown
  tool_call?: unknown
  reasoning_options?: unknown
}

export interface SelectedModelRecord {
  providerID: string
  modelID: string
  record: ModelsDevRecord
}

export interface ModelVariant {
  id: string
  settings: Record<string, unknown>
}

interface FamilyProviders {
  primary: string
  alternatives: string[]
}

const FAMILY_RULES: Array<[RegExp, FamilyProviders]> = [
  [/^(?:gpt-|o\d|.*codex)/, { primary: "openai", alternatives: [] }],
  [/^claude-/, { primary: "anthropic", alternatives: [] }],
  [/^gemini-/, { primary: "google", alternatives: [] }],
  [/^grok-/, { primary: "xai", alternatives: [] }],
  [/^glm-/, { primary: "zai", alternatives: ["zhipuai"] }],
  [/^deepseek-/, { primary: "deepseek", alternatives: [] }],
  [/^kimi-/, { primary: "moonshotai", alternatives: ["moonshotai-cn"] }],
  [/^mimo-/, { primary: "xiaomi", alternatives: [] }],
  [/^minimax-/, { primary: "minimax", alternatives: ["minimax-cn"] }],
  [/^qwen/, { primary: "alibaba", alternatives: ["alibaba-cn"] }],
]

function providers(catalog: unknown): Array<[string, Record<string, unknown>]> {
  if (!isRecord(catalog)) return []
  return Object.entries(catalog).flatMap(([providerID, provider]) => {
    if (!isRecord(provider) || !isRecord(provider.models)) return []
    return [[providerID, provider.models] as [string, Record<string, unknown>]]
  })
}

function findExact(
  models: Record<string, unknown>,
  candidate: string,
): [string, ModelsDevRecord] | undefined {
  const normalized = candidate.toLowerCase()
  for (const [key, value] of Object.entries(models)) {
    if (!isRecord(value)) continue
    const id = optionalString(value.id) ?? key
    if (key.toLowerCase() === normalized || id.toLowerCase() === normalized) {
      return [id, value]
    }
  }
  return undefined
}

export function candidateModelIDs(group: DeploymentGroup): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  const add = (value: string | undefined) => {
    if (!value) return
    const normalized = value.toLowerCase()
    if (seen.has(normalized)) return
    seen.add(normalized)
    result.push(value)
  }

  for (const deployment of group.deployments) {
    add(optionalString(deployment.modelInfo.base_model))
    const routed = optionalString(deployment.litellmParams.model)
    add(routed ? stripRoutePrefix(routed) : undefined)
  }
  add(group.modelName)
  return result
}

export function familyProviders(group: DeploymentGroup): FamilyProviders | undefined {
  for (const deployment of group.deployments) {
    const explicit = optionalString(deployment.modelInfo.models_dev_provider)
    if (explicit) return { primary: explicit, alternatives: [] }
  }

  for (const candidate of candidateModelIDs(group)) {
    const normalized = stripRoutePrefix(candidate).toLowerCase()
    const match = FAMILY_RULES.find(([pattern]) => pattern.test(normalized))
    if (match) return match[1]
  }
  return undefined
}

export function selectModelsDevRecord(
  group: DeploymentGroup,
  catalog: unknown,
): SelectedModelRecord | undefined {
  const allProviders = providers(catalog)
  const family = familyProviders(group)
  const preferred = family ? [family.primary, ...family.alternatives] : []

  for (const candidate of candidateModelIDs(group)) {
    for (const providerID of preferred) {
      const provider = allProviders.find(([id]) => id.toLowerCase() === providerID.toLowerCase())
      if (!provider) continue
      const match = findExact(provider[1], candidate)
      if (match) return { providerID: provider[0], modelID: match[0], record: match[1] }
    }

    const zen = allProviders.find(([id]) => id.toLowerCase() === "opencode")
    const zenMatch = zen && findExact(zen[1], candidate)
    if (zen && zenMatch) return { providerID: zen[0], modelID: zenMatch[0], record: zenMatch[1] }

    const matches = allProviders.flatMap(([providerID, models]) => {
      const match = findExact(models, candidate)
      return match ? [{ providerID, modelID: match[0], record: match[1] }] : []
    })
    if (matches.length === 1) return matches[0]
  }

  return undefined
}

function effortVariants(options: unknown, protocol: Protocol): ModelVariant[] {
  if (!isRecord(options) || options.type !== "effort" || !Array.isArray(options.values)) return []
  const key = protocol === "messages" ? "effort" : "reasoningEffort"
  const values = options.values.filter((value): value is string => typeof value === "string")
  return [...new Set(values)].map((value) => ({ id: value, settings: { [key]: value } }))
}

function budgetVariants(options: unknown, protocol: Protocol): ModelVariant[] {
  if (!isRecord(options) || options.type !== "budget_tokens" || protocol !== "messages") return []
  const declaredMax = optionalNumber(options.max)
  const maximum = declaredMax !== undefined && declaredMax > 0 ? Math.floor(declaredMax) : undefined
  const high = maximum === undefined ? 16000 : Math.min(16000, maximum)
  const result: ModelVariant[] = [
    { id: "high", settings: { thinking: { type: "enabled", budgetTokens: high } } },
  ]
  if (maximum !== undefined && maximum > high) {
    result.push({
      id: "max",
      settings: { thinking: { type: "enabled", budgetTokens: maximum } },
    })
  }
  return result
}

export function buildVariants(
  selected: SelectedModelRecord | undefined,
  protocol: Protocol,
): ModelVariant[] {
  const options = selected?.record.reasoning_options
  if (!Array.isArray(options)) return []

  const byID = new Map<string, ModelVariant>()
  for (const option of options) {
    for (const variant of [...effortVariants(option, protocol), ...budgetVariants(option, protocol)]) {
      if (!byID.has(variant.id)) byID.set(variant.id, variant)
    }
  }
  return [...byID.values()]
}

export function releaseTimestamp(selected: SelectedModelRecord | undefined): number {
  const value = selected?.record.release_date
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return 0
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}
