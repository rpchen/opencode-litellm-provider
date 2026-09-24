import type { Protocol } from "../options.js"
import { mapCapabilities, type ModelCapabilities, type ModelCost, type ModelLimits } from "./capabilities.js"
import { groupLiteLLMDeployments } from "./litellm.js"
import {
  buildVariants,
  releaseTimestamp,
  selectModelsDevRecord,
  type ModelVariant,
} from "./modelsdev.js"
import { PROTOCOL_PACKAGES, resolveProtocol } from "./protocol.js"

export interface BuildOptions {
  contextTierCap: boolean
  protocolOverrides: Readonly<Record<string, Protocol>>
}

export interface ModelSpec {
  id: string
  name: string
  protocol: Protocol
  package: string
  capabilities: ModelCapabilities
  variants: ModelVariant[]
  released: number
  cost: ModelCost
  limit: ModelLimits
}

export function buildModelSpecs(
  litellmResponse: unknown,
  modelsDevCatalog: unknown,
  options: BuildOptions,
): ModelSpec[] {
  return groupLiteLLMDeployments(litellmResponse)
    .map((group): ModelSpec => {
      const protocol = resolveProtocol(group, options.protocolOverrides)
      const selected = selectModelsDevRecord(group, modelsDevCatalog)
      const mapped = mapCapabilities(group, selected, options.contextTierCap)
      return {
        id: group.modelName,
        name: group.modelName,
        protocol,
        package: PROTOCOL_PACKAGES[protocol],
        capabilities: mapped.capabilities,
        variants: buildVariants(selected, protocol),
        released: releaseTimestamp(selected),
        cost: mapped.cost,
        limit: mapped.limit,
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, item]) => [key, stableValue(item)]),
  )
}

export function modelFingerprint(models: readonly ModelSpec[]): string {
  return JSON.stringify(stableValue(models))
}
