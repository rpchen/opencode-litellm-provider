import type { ValidationState } from "./host/endpoint-state.js"

export const DEFAULT_ENDPOINT_ID = "default"
export const BASE_PLUGIN_ID = "litellm"

export interface EndpointIdentity {
  readonly id: string
  readonly integrationId: string
  readonly providerId: string
  readonly displayName: string
  /** Only set when validation.kind === "ok"; invalid endpoints never expose a fetchable URL. */
  readonly fixedBaseUrl?: string
  readonly legacy: boolean
  /** Endpoint definition validation, loaded from the declaring config file. */
  readonly validation: ValidationState
}

export function endpointIdentity(
  id: string,
  fixedBaseUrl?: string,
  legacy = false,
  validation: ValidationState = { kind: "ok" },
): EndpointIdentity {
  const providerId = id === DEFAULT_ENDPOINT_ID ? BASE_PLUGIN_ID : `${BASE_PLUGIN_ID}-${id}`
  return {
    id,
    integrationId: providerId,
    providerId,
    displayName: id === DEFAULT_ENDPOINT_ID ? "LiteLLM" : `LiteLLM · ${id}`,
    fixedBaseUrl: validation.kind === "ok" ? fixedBaseUrl : undefined,
    legacy,
    validation,
  }
}

export type EndpointActivation =
  | { readonly mode: "all" }
  | { readonly mode: "selected"; readonly endpointIds: readonly string[] }

export const ACTIVATION_STORAGE_KEY = "litellm.activation.v1"

export function activeEndpointIds(
  ids: readonly string[],
  activation: EndpointActivation,
): string[] {
  if (activation.mode === "all") return [...ids]
  const selected = new Set(activation.endpointIds)
  return ids.filter((id) => selected.has(id))
}

export function toggleEndpoint(
  ids: readonly string[],
  activation: EndpointActivation,
  id: string,
): EndpointActivation {
  const selected = new Set(activation.mode === "all" ? ids : activation.endpointIds)
  if (selected.has(id)) selected.delete(id)
  else selected.add(id)
  return { mode: "selected", endpointIds: [...selected] }
}

export function parseActivation(value: unknown): EndpointActivation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { mode: "all" }
  const record = value as Record<string, unknown>
  if (record.mode === "all") return { mode: "all" }
  if (
    record.mode === "selected" &&
    Array.isArray(record.endpointIds) &&
    record.endpointIds.every((id) => typeof id === "string")
  ) {
    return { mode: "selected", endpointIds: [...new Set(record.endpointIds as string[])] }
  }
  return { mode: "all" }
}
