import {
  isRecord,
  optionalBoolean,
  optionalNumber,
  positiveInteger,
  stripRoutePrefix,
  type DeploymentGroup,
  type LiteLLMDeployment,
} from "./litellm.js"
import { candidateModelIDs, type SelectedModelRecord } from "./modelsdev.js"

export interface ModelCapabilities {
  tools: boolean
  input: string[]
  output: string[]
}

export interface ModelLimits {
  context: number
  input: number
  output: number
}

export interface ModelCost {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface CapabilityResult {
  capabilities: ModelCapabilities
  limit: ModelLimits
  cost: ModelCost
}

const INPUT_MODALITIES = [
  ["supports_vision", "image"],
  ["supports_pdf_input", "pdf"],
  ["supports_audio_input", "audio"],
  ["supports_video_input", "video"],
] as const

const OUTPUT_MODALITIES = [["supports_audio_output", "audio"]] as const

function modelsDevModalities(selected: SelectedModelRecord | undefined, direction: "input" | "output"): string[] {
  const modalities = selected?.record.modalities
  if (!isRecord(modalities) || !Array.isArray(modalities[direction])) return []
  return modalities[direction].filter((value): value is string => typeof value === "string")
}

function modelsDevLimit(selected: SelectedModelRecord | undefined, key: "context" | "output"): number | undefined {
  const limit = selected?.record.limit
  return isRecord(limit) ? positiveInteger(limit[key]) : undefined
}

function modelsDevCost(selected: SelectedModelRecord | undefined, key: string): number | undefined {
  const cost = selected?.record.cost
  if (!isRecord(cost)) return undefined
  const value = optionalNumber(cost[key])
  return value !== undefined && value >= 0 ? value : undefined
}

function deploymentModalities(
  deployment: LiteLLMDeployment,
  selected: SelectedModelRecord | undefined,
  direction: "input" | "output",
): Set<string> {
  const result = new Set<string>(["text"])
  const fallback = new Set(modelsDevModalities(selected, direction))
  const mappings = direction === "input" ? INPUT_MODALITIES : OUTPUT_MODALITIES
  for (const [field, modality] of mappings) {
    const value = optionalBoolean(deployment.modelInfo[field])
    if (value === true || (value === undefined && fallback.has(modality))) result.add(modality)
  }
  return result
}

function intersect(sets: Set<string>[]): string[] {
  if (sets.length === 0) return ["text"]
  return [...sets[0]!].filter((value) => sets.every((set) => set.has(value)))
}

function isModalitiesTrustFamily(group: DeploymentGroup): boolean {
  return candidateModelIDs(group).some((candidate) =>
    /^(?:deepseek-|kimi-|mimo-|qwen)/.test(stripRoutePrefix(candidate).toLowerCase()),
  )
}

function minimum(values: Array<number | undefined>, fallback = 0): number {
  const provided = values.filter((value): value is number => value !== undefined)
  return provided.length > 0 ? Math.min(...provided) : fallback
}

function tierPoint(deployment: LiteLLMDeployment): number | undefined {
  const points: number[] = []
  for (const [key, rawValue] of Object.entries(deployment.modelInfo)) {
    const match = /^input_cost_per_token_above_(\d+)k_tokens$/.exec(key)
    const value = optionalNumber(rawValue)
    if (match?.[1] && value !== undefined && value !== 0) points.push(Number(match[1]) * 1000)
  }

  const tiers = deployment.modelInfo.tiered_pricing
  if (Array.isArray(tiers)) {
    for (const tier of tiers) {
      if (!isRecord(tier) || !Array.isArray(tier.range)) continue
      const start = optionalNumber(tier.range[0])
      if (start !== undefined && start > 0) points.push(Math.floor(start))
    }
  }
  return points.length > 0 ? Math.min(...points) : undefined
}

function perTokenCost(
  deployments: LiteLLMDeployment[],
  fields: string[],
  fallback: number | undefined,
): number {
  const values = deployments.flatMap((deployment) => {
    for (const field of fields) {
      const value = optionalNumber(deployment.modelInfo[field])
      if (value !== undefined && value >= 0) return [value * 1_000_000]
    }
    return []
  })
  return values.length > 0 ? Math.max(...values) : (fallback ?? 0)
}

export function mapCapabilities(
  group: DeploymentGroup,
  selected: SelectedModelRecord | undefined,
  contextTierCap: boolean,
): CapabilityResult {
  const mdTools = optionalBoolean(selected?.record.tool_call)
  const tools = group.deployments.every(
    (deployment) => optionalBoolean(deployment.modelInfo.supports_function_calling) ?? mdTools ?? true,
  )

  const inputSets = group.deployments.map((deployment) => deploymentModalities(deployment, selected, "input"))
  let input = intersect(inputSets)
  const mdInput = modelsDevModalities(selected, "input")
  const liteLLMDeclaresExtraInput = group.deployments.some((deployment) =>
    INPUT_MODALITIES.some(([field]) => optionalBoolean(deployment.modelInfo[field]) === true),
  )
  if (isModalitiesTrustFamily(group) && !liteLLMDeclaresExtraInput && mdInput.length > 1) {
    input = [...new Set(["text", ...mdInput])]
  }
  const output = intersect(
    group.deployments.map((deployment) => deploymentModalities(deployment, selected, "output")),
  )

  const mdContext = modelsDevLimit(selected, "context")
  const contextValues = group.deployments.map(
    (deployment) => positiveInteger(deployment.modelInfo.max_input_tokens) ?? mdContext,
  )
  let context = minimum(contextValues)
  if (contextTierCap) {
    const firstTier = minimum(group.deployments.map(tierPoint), Number.POSITIVE_INFINITY)
    if (Number.isFinite(firstTier)) context = context > 0 ? Math.min(context, firstTier) : firstTier
  }

  const mdOutput = modelsDevLimit(selected, "output")
  const outputLimit = minimum(
    group.deployments.map(
      (deployment) =>
        positiveInteger(deployment.modelInfo.max_output_tokens) ??
        positiveInteger(deployment.modelInfo.max_tokens) ??
        mdOutput,
    ),
  )

  return {
    capabilities: { tools, input, output },
    limit: { context, input: context, output: outputLimit },
    cost: {
      input: perTokenCost(group.deployments, ["input_cost_per_token"], modelsDevCost(selected, "input")),
      output: perTokenCost(group.deployments, ["output_cost_per_token"], modelsDevCost(selected, "output")),
      cacheRead: perTokenCost(
        group.deployments,
        ["cache_read_input_token_cost", "cache_read_cost_per_token"],
        modelsDevCost(selected, "cache_read"),
      ),
      cacheWrite: perTokenCost(
        group.deployments,
        ["cache_creation_input_token_cost", "cache_write_input_token_cost"],
        modelsDevCost(selected, "cache_write"),
      ),
    },
  }
}
