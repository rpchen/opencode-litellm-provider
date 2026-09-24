import type { Protocol } from "../options.js"
import {
  optionalString,
  stripRoutePrefix,
  type DeploymentGroup,
  type LiteLLMDeployment,
} from "./litellm.js"

export const PROTOCOL_PACKAGES: Record<Protocol, string> = {
  chat: "@opencode/ai/providers/openai-compatible",
  responses: "@opencode/ai/providers/openai/responses",
  messages: "@opencode/ai/providers/anthropic",
}

function isClaudeName(value: unknown): boolean {
  const model = optionalString(value)
  return model !== undefined && stripRoutePrefix(model).toLowerCase().startsWith("claude-")
}

function isAnthropic(deployment: LiteLLMDeployment): boolean {
  const upstream = optionalString(deployment.modelInfo.litellm_provider)?.toLowerCase()
  const custom = optionalString(deployment.litellmParams.custom_llm_provider)?.toLowerCase()
  const routedModel = optionalString(deployment.litellmParams.model)

  return (
    upstream === "anthropic" ||
    custom === "anthropic" ||
    routedModel?.toLowerCase().startsWith("anthropic/") === true ||
    isClaudeName(deployment.modelInfo.base_model) ||
    isClaudeName(routedModel) ||
    isClaudeName(deployment.modelName)
  )
}

function normalizeEndpoint(value: string): string {
  return value.toLowerCase().replace(/^\//, "").replace(/^v1\//, "")
}

export function deploymentProtocol(deployment: LiteLLMDeployment): Protocol {
  if (isAnthropic(deployment)) return "messages"

  const endpoints = deployment.modelInfo.supported_endpoints
  if (Array.isArray(endpoints)) {
    const normalized = new Set(
      endpoints
        .filter((endpoint): endpoint is string => typeof endpoint === "string")
        .map(normalizeEndpoint),
    )
    if (normalized.has("responses")) return "responses"
    if (normalized.has("chat/completions")) return "chat"
  }

  return optionalString(deployment.modelInfo.mode)?.toLowerCase() === "responses"
    ? "responses"
    : "chat"
}

export function resolveProtocol(
  group: DeploymentGroup,
  overrides: Readonly<Record<string, Protocol>> = {},
): Protocol {
  const override = overrides[group.modelName]
  if (override) return override

  const protocols = new Set(group.deployments.map(deploymentProtocol))
  return protocols.size === 1 ? (protocols.values().next().value ?? "chat") : "chat"
}
