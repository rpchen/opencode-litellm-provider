import type { ConnectionInfo } from "@opencode/client"
import { Model, Plugin, Provider } from "@opencode/plugin"
import type { ModelSpec } from "../core/build.js"
import { PROTOCOL_PACKAGES } from "../core/protocol.js"

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

export interface ProviderSnapshot {
  ready: boolean
  connection?: ConnectionInfo
  apiBaseURL?: string
  models: ModelSpec[]
}

export function applyIntegration(editor: IntegrationEditorLike): void {
  editor.update(INTEGRATION_ID, (integration) => {
    integration.name = "LiteLLM"
  })
  editor.method.update({
    integrationID: INTEGRATION_ID,
    method: {
      type: "key",
      label: "API Key",
      form: [
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

function toModelInfo(spec: ModelSpec): Model.Info {
  const providerID = PROVIDER_ID as Provider.ID
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

export function applyProvider(editor: ProviderEditorLike, snapshot: ProviderSnapshot): void {
  if (!snapshot.ready || !snapshot.connection || !snapshot.apiBaseURL) return

  editor.add({
    info: {
      ...Provider.Info.empty(PROVIDER_ID as Provider.ID),
      id: PROVIDER_ID as Provider.ID,
      integrationID: INTEGRATION_ID,
      name: "LiteLLM",
      activation: "auto",
      package: PROTOCOL_PACKAGES.chat,
      settings: { baseURL: snapshot.apiBaseURL },
    } as unknown as Provider.Info,
    models: snapshot.models.map(toModelInfo),
    sourceConnection: snapshot.connection,
  })
}

export function registerIntegration(context: Pick<Plugin.Context, "integration">): Promise<Registration> {
  return context.integration.transform((editor) => applyIntegration(editor as unknown as IntegrationEditorLike))
}

export function registerProvider(
  context: Pick<Plugin.Context, "provider">,
  snapshot: ProviderSnapshot,
): Promise<Registration> {
  return context.provider.transform((editor) => applyProvider(editor, snapshot))
}
