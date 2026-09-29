import type { ConnectionInfo } from "@opencode/client"
import { Model, Plugin, Provider } from "@opencode/plugin"
import type { ModelSpec } from "../core/build.js"
import type { DiscoveryCacheDiagnostics, DiscoveryDiagnostics } from "../generated/discovery-core/index.js"
import { PROTOCOL_PACKAGES } from "../core/protocol.js"
import { endpointIdentity, type EndpointIdentity } from "../endpoints.js"

export interface Registration {
  readonly dispose: () => Promise<void>
}

export interface IntegrationEditorLike {
  update(id: string, update: (integration: { id: string; name: string }) => void): void
  readonly method: {
    update(input: {
      integrationID: string
      method: {
        type: "key"
        label: string
        form: Array<{
          key: string
          type: "string"
          format: "uri"
          required: boolean
          title: string
          placeholder: string
        }>
      }
    }): void
  }
}

export interface ProviderEditorLike {
  add(input: {
    info: Provider.Info
    models: readonly Model.Info[]
    sourceConnection?: ConnectionInfo
  }): void
}

export const INTEGRATION_ID = "litellm"
export const PROVIDER_ID = "litellm"
const DEFAULT_IDENTITY = endpointIdentity("default", undefined, true)

export type DiscoveryStatus =
  | "disconnected"
  | "pending"
  | "switching"
  | "ready"
  | "empty"
  | "stale"
  | "cleared-auth"
  | "cleared-notfound"

export interface RegistrationView {
  readonly info: Provider.Info
  readonly models: readonly Model.Info[]
  readonly protocols: Readonly<Record<string, ModelSpec["protocol"]>>
  readonly releaseUnits: Readonly<Record<string, NonNullable<ModelSpec["releaseUnit"]>>>
}

export interface AuditSnapshot {
  readonly status: DiscoveryStatus
  readonly lastSuccessfulDiscoveryAt?: string
  readonly view?: RegistrationView
}

export interface ProviderDiagnosticsSnapshot {
  readonly discovery?: DiscoveryDiagnostics
  readonly cache?: DiscoveryCacheDiagnostics
  readonly note?: string
}

export interface ProviderSnapshot {
  ready: boolean
  connection?: ConnectionInfo
  apiBaseURL?: string
  models: ModelSpec[]
  registrationView?: RegistrationView
  audit?: AuditSnapshot
  diagnostics?: ProviderDiagnosticsSnapshot
}

export function applyIntegration(editor: IntegrationEditorLike, endpoint: EndpointIdentity = DEFAULT_IDENTITY): void {
  editor.update(endpoint.integrationId, (integration) => {
    integration.name = endpoint.displayName
  })
  editor.method.update({
    integrationID: endpoint.integrationId,
    method: {
      type: "key",
      label: "API Key",
      form: endpoint.fixedBaseUrl ? [] : [
        {
          key: "url",
          type: "string",
          format: "uri",
          required: true,
          title: "LiteLLM 地址",
          placeholder: "http://litellm.example:4000",
        },
      ],
    },
  })
}

function toModelInfo(spec: ModelSpec, endpoint: EndpointIdentity): Model.Info {
  const providerID = endpoint.providerId as Provider.ID
  const modelID = spec.id as Model.ID
  return {
    ...Model.Info.default(providerID, modelID),
    id: modelID,
    modelID,
    providerID,
    name: spec.name,
    package: spec.package,
    capabilities: spec.capabilities,
    variants: spec.variants.map((variant) => ({
      id: variant.id as Model.VariantID,
      settings: variant.settings,
    })),
    time: { released: spec.released },
    cost: [
      {
        input: spec.cost.input,
        output: spec.cost.output,
        cache: { read: spec.cost.cacheRead, write: spec.cost.cacheWrite },
      },
    ],
    status: "active",
    enabled: true,
    limit: spec.limit,
  } as unknown as Model.Info
}

function freezeDeep<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value
  seen.add(value)
  for (const item of Object.values(value)) freezeDeep(item, seen)
  return Object.freeze(value)
}

export function createRegistrationView(models: readonly ModelSpec[], apiBaseURL: string, endpoint: EndpointIdentity = DEFAULT_IDENTITY): RegistrationView {
  const specs = structuredClone(models) as ModelSpec[]
  const protocols = Object.fromEntries(specs.map((spec) => [spec.id, spec.protocol]))
  const releaseUnits = Object.fromEntries(specs.map((spec) => [
    spec.id,
    spec.releaseUnit ?? (spec.released === 0 ? "none" : "unknown"),
  ]))
  return freezeDeep({
    info: {
      ...Provider.Info.empty(endpoint.providerId as Provider.ID),
      id: endpoint.providerId as Provider.ID,
      integrationID: endpoint.integrationId,
      name: endpoint.displayName,
      activation: "auto",
      package: PROTOCOL_PACKAGES.chat,
      settings: { baseURL: apiBaseURL },
    } as unknown as Provider.Info,
    models: specs.map((spec) => toModelInfo(spec, endpoint)),
    protocols,
    releaseUnits,
  })
}

export function applyProvider(editor: ProviderEditorLike, snapshot: ProviderSnapshot, endpoint: EndpointIdentity = DEFAULT_IDENTITY): void {
  if (!snapshot.ready || !snapshot.connection || !snapshot.apiBaseURL) return
  const view = snapshot.registrationView ?? snapshot.audit?.view ?? createRegistrationView(snapshot.models, snapshot.apiBaseURL, endpoint)

  editor.add({
    info: view.info,
    models: view.models,
    sourceConnection: snapshot.connection,
  })
}

export function registerIntegration(context: Pick<Plugin.Context, "integration">, endpoint: EndpointIdentity = DEFAULT_IDENTITY): Promise<Registration> {
  return context.integration.transform((editor) => applyIntegration(editor as unknown as IntegrationEditorLike, endpoint))
}

export function registerIntegrations(
  context: Pick<Plugin.Context, "integration">,
  endpoints: readonly EndpointIdentity[],
): Promise<Registration> {
  return context.integration.transform((editor) => {
    const target = editor as unknown as IntegrationEditorLike
    for (const endpoint of endpoints) applyIntegration(target, endpoint)
  })
}

export function registerProvider(
  context: Pick<Plugin.Context, "provider">,
  snapshot: ProviderSnapshot,
  endpoint: EndpointIdentity = DEFAULT_IDENTITY,
): Promise<Registration> {
  return context.provider.transform((editor) => applyProvider(editor, snapshot, endpoint))
}
