import { describe, expect, test } from "bun:test"
import type { ConnectionInfo } from "@opencode/client"
import { officialCatalog } from "./fixtures/catalog.js"
import { endpointIdentity } from "../src/endpoints.js"
import { getModelsDevCatalog } from "../src/net/fetch.js"
import { createDiscoveryLoop, type SyncContext } from "../src/host/sync.js"
import type { ProviderSnapshot } from "../src/host/register.js"
import type { PluginOptions } from "../src/options.js"

const ROOT = "http://litellm.example:4000"

function response(names: readonly string[], route = "openai/"): unknown {
  return {
    data: names.map((model_name) => ({
      model_name,
      litellm_params: { model: `${route}${model_name}` },
      model_info: {
        mode: "chat",
        max_input_tokens: 100000,
        max_output_tokens: 10000,
        supports_function_calling: true,
        supports_reasoning: false,
        supports_vision: false,
        supports_pdf_input: false,
        supports_audio_input: false,
        supports_video_input: false,
        supports_audio_output: false,
      },
    })),
  }
}

function catalog(names: readonly string[]): unknown {
  return officialCatalog(Object.fromEntries(names.map((name) => [
    `openai/${name}`,
    {
      limit: { context: 100000, output: 10000 },
      tool_call: true,
      reasoning: false,
      modalities: { input: ["text"], output: ["text"] },
    },
  ])))
}

function harness() {
  let live: unknown = response(["model-a"])
  let localCatalog: unknown = catalog(["model-a"])
  let latestCatalog: unknown = localCatalog
  let fetches = 0
  let catalogRequests = 0
  let forceCatalogRequests = 0
  let forceCatalogFailure = false
  const context: SyncContext = {
    integration: {
      connection: {
        active: async () => ({ type: "credential", id: "fixture", label: "fixture", method: "key" }) as ConnectionInfo,
        resolve: async () => ({ type: "key", key: "sk-test", configuration: { url: ROOT } }),
      },
    },
    provider: { reload: async () => {} },
    event: { subscribe: () => ({ [Symbol.asyncIterator]: async function* () {} }) as AsyncIterable<{ type: string }> },
  }
  const snapshot: ProviderSnapshot = { ready: false, models: [] }
  const options: PluginOptions = { pollInterval: 3600, contextTierCap: false, protocolOverrides: {}, conversationFeedback: false }
  const loop = createDiscoveryLoop(context, snapshot, options, {
    logger: { warn() {}, error() {} },
    fetchLiteLLM: async () => { fetches += 1; return live },
    getModelsDev: async (request: Parameters<typeof getModelsDevCatalog>[0] = {}) => {
      catalogRequests += 1
      if (request.forceRefresh) {
        forceCatalogRequests += 1
        if (forceCatalogFailure) throw Object.assign(new Error("models.dev offline"), { code: "ECONNREFUSED" })
        return latestCatalog
      }
      return localCatalog
    },
  }, endpointIdentity("default", undefined, true))
  return {
    loop,
    snapshot,
    setLive(value: unknown) { live = value },
    setLocalCatalog(value: unknown) { localCatalog = value },
    setLatestCatalog(value: unknown) { latestCatalog = value },
    setForceCatalogFailure(value: boolean) { forceCatalogFailure = value },
    get fetches() { return fetches },
    get catalogRequests() { return catalogRequests },
    get forceCatalogRequests() { return forceCatalogRequests },
  }
}

test("incremental discovery uses model_name identity and demand-driven catalog refresh", async () => {
  const h = harness()
  await h.loop.start()
  try {
    expect(h.snapshot.models.map((model) => model.id)).toEqual(["model-a"])
    expect(h.catalogRequests).toBe(1)
    expect(h.forceCatalogRequests).toBe(0)

    // Same identity, including an internal route change: no metadata work.
    h.setLive(response(["model-a"], "private/"))
    await h.loop.trigger(true)
    expect(h.snapshot.models.map((model) => model.id)).toEqual(["model-a"])
    expect(h.catalogRequests).toBe(1)

    // New model with a local catalog hit: process only the addition, no latest fetch.
    h.setLocalCatalog(catalog(["model-a", "model-b"]))
    h.setLive(response(["model-a", "model-b"]))
    await h.loop.trigger(true)
    expect(h.snapshot.models.map((model) => model.id)).toEqual(["model-a", "model-b"])
    expect(h.forceCatalogRequests).toBe(0)

    // New model absent locally: ask for the latest catalog exactly once.
    h.setLocalCatalog(catalog(["model-a", "model-b"]))
    h.setLatestCatalog(catalog(["model-a", "model-b", "model-c"]))
    h.setLive(response(["model-a", "model-b", "model-c"]))
    await h.loop.trigger(true)
    expect(h.snapshot.models.map((model) => model.id)).toEqual(["model-a", "model-b", "model-c"])
    expect(h.forceCatalogRequests).toBe(1)

    // Deletion does not need metadata, and another route-only change remains free.
    h.setLive(response(["model-a", "model-b"], "private/"))
    await h.loop.trigger(true)
    expect(h.snapshot.models.map((model) => model.id)).toEqual(["model-a", "model-b"])
    expect(h.catalogRequests).toBe(4)
    expect(h.forceCatalogRequests).toBe(1)
  } finally {
    await h.loop.dispose()
  }
})

test("temporary metadata-withheld models recover on an unchanged set; stable unmatched models do not retry", async () => {
  const h = harness()
  await h.loop.start()
  try {
    expect(h.snapshot.models.map((model) => model.id)).toEqual(["model-a"])

    h.setForceCatalogFailure(true)
    h.setLive(response(["model-a", "model-b"]))
    await h.loop.trigger(true)
    expect(h.snapshot.models.map((model) => model.id)).toEqual(["model-a"])
    expect(h.snapshot.diagnostics?.publication?.withheld.map((entry) => entry.id)).toEqual(["model-b"])
    expect(h.snapshot.diagnostics?.publication?.failureKind).toBe("unreachable")

    h.setForceCatalogFailure(false)
    h.setLatestCatalog(catalog(["model-a", "model-b"]))
    await h.loop.trigger(true)
    expect(h.snapshot.models.map((model) => model.id)).toEqual(["model-a", "model-b"])
    expect(h.snapshot.diagnostics?.publication?.withheld).toEqual([])
    expect(h.forceCatalogRequests).toBe(2)

    h.setLocalCatalog(catalog(["model-a", "model-b"]))
    h.setLatestCatalog(catalog(["model-a", "model-b"]))
    h.setLive(response(["model-a", "model-b", "stable-unmatched"]))
    await h.loop.trigger(true)
    expect(h.snapshot.models.map((model) => model.id)).toEqual(["model-a", "model-b"])
    expect(h.snapshot.diagnostics?.publication?.withheld[0]?.status).toBe("unmatched")
    const requestsAfterStableMiss = h.catalogRequests

    h.setLatestCatalog(catalog(["model-a", "model-b", "stable-unmatched"]))
    await h.loop.trigger(true)
    expect(h.snapshot.models.map((model) => model.id)).toEqual(["model-a", "model-b"])
    expect(h.catalogRequests).toBe(requestsAfterStableMiss)

    // Removing a transient metadata-withheld name must prune it before Core
    // recovery candidates are selected; this deletion needs no catalog access.
    h.setForceCatalogFailure(true)
    h.setLive(response(["model-a", "model-b", "stable-unmatched", "deleted-temporary"]))
    await h.loop.trigger(true)
    expect(h.snapshot.models.map((model) => model.id)).toEqual(["model-a", "model-b"])
    expect(h.snapshot.diagnostics?.publication?.withheld.map((entry) => entry.id).sort()).toEqual(["deleted-temporary", "stable-unmatched"])
    h.setLive(response(["model-a", "model-b", "stable-unmatched"]))
    const requestsBeforeDeletion = h.catalogRequests
    await h.loop.trigger(true)
    expect(h.snapshot.models.map((model) => model.id)).toEqual(["model-a", "model-b"])
    expect(h.catalogRequests).toBe(requestsBeforeDeletion)
    expect(h.snapshot.diagnostics?.publication?.withheld.map((entry) => entry.id)).toEqual(["stable-unmatched"])
  } finally {
    await h.loop.dispose()
  }
})
