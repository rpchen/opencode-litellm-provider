import { expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import { setupLiteLLM } from "../src/index.js"
import { ACTIVATION_STORAGE_KEY } from "../src/endpoints.js"
import type { EndpointActivationView } from "../src/host/endpoint-command.js"
import type { ProviderEditorLike } from "../src/host/register.js"
import discovery from "./fixtures/metadata-priority/synthetic-discovery.json" with { type: "json" }
import catalog from "./fixtures/metadata-priority/modelsdev-subset.json" with { type: "json" }

async function locationRuntime(storage: Map<string, unknown>) {
  const transforms = new Set<(editor: ProviderEditorLike) => void>()
  const providers = new Map<string, number>()
  const reload = async () => {
    providers.clear()
    for (const transform of transforms) transform({ add: ({ info, models }) => providers.set(info.id, models.length) })
  }
  let state!: () => Promise<EndpointActivationView>
  let set!: (input: { action: string; endpointId: string }) => Promise<EndpointActivationView>
  const registration = { dispose: async () => {} }
  const context = {
    options: { endpoints: { company: { baseUrl: "https://litellm.example" } } },
    storage: { get: async (key: string) => storage.get(key), set: async (key: string, value: unknown) => { storage.set(key, value) } },
    integration: {
      transform: async () => registration,
      connection: {
        active: async () => ({ type: "credential", id: "test-credential", label: "test", method: "key" }),
        resolve: async () => ({ type: "key", key: "sk-test-only" }),
      },
    },
    provider: {
      transform: async (transform: (editor: ProviderEditorLike) => void) => {
        transforms.add(transform)
        await reload()
        return { dispose: async () => { transforms.delete(transform); await reload() } }
      },
      reload,
    },
    rpc: {
      register: async (definition: { id: string }, handlers: { state: typeof state; set: typeof set }) => {
        if (definition.id === "litellm-endpoints") { state = handlers.state; set = handlers.set }
        return { ...registration, events: { emit: async () => {} } }
      },
    },
    command: { transform: async () => registration },
    event: {
      subscribe: ({ signal }: { signal: AbortSignal }) => ({
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise<IteratorResult<never>>((resolve) => {
            if (signal.aborted) resolve({ done: true, value: undefined })
            else signal.addEventListener("abort", () => resolve({ done: true, value: undefined }), { once: true })
          }),
        }),
      }),
    },
  } as unknown as Plugin.Context
  const dispose = await setupLiteLLM(context, {
    fetchLiteLLM: async () => discovery,
    getModelsDev: async () => catalog,
    scheduler: { setTimeout: () => undefined, clearTimeout: () => {} },
  })
  return { providers, state, set, dispose }
}

test("[ACT-LOCATION-REFRESH] existing locations reconcile persisted activation and publish their models", async () => {
  const storage = new Map<string, unknown>([[ACTIVATION_STORAGE_KEY, JSON.stringify({ mode: "selected", endpointIds: [] })]])
  const first = await locationRuntime(storage)
  const second = await locationRuntime(storage)
  try {
    expect((await second.state()).activeEndpointIds).toEqual([])
    await first.set({ action: "toggle", endpointId: "company" })
    const refreshed = await second.state()
    expect(refreshed.activeEndpointIds).toEqual(["company"])
    await Bun.sleep(10)
    expect(second.providers.get("litellm-company")).toBeGreaterThan(0)
    expect((await second.state()).endpoints?.[0]?.status).toBe("enabled-active")
    await second.set({ action: "none", endpointId: "" })
    expect((await first.state()).activeEndpointIds).toEqual([])
    expect(first.providers.has("litellm-company")).toBeFalse()
    expect(second.providers.has("litellm-company")).toBeFalse()
  } finally {
    await first.dispose()
    await second.dispose()
  }
})
