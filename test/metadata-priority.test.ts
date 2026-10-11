import { describe, expect, test } from "bun:test"
import discovery from "./fixtures/metadata-priority/synthetic-discovery.json" with { type: "json" }
import catalog from "./fixtures/metadata-priority/modelsdev-subset.json" with { type: "json" }
import oracle from "./fixtures/metadata-priority/expected-16.json" with { type: "json" }
import { buildPublicationResult, createDiscoverySnapshot, endpointFingerprint, diagnoseModelSpecs, type ModelSpec } from "../src/generated/discovery-core/index.js"
import { buildPublicationModels } from "../src/host/models.js"
import { createRegistrationView, type ProviderSnapshot } from "../src/host/register.js"
import { createDiscoveryLoop, type SyncContext } from "../src/host/sync.js"
import { createAuditReport } from "../src/host/audit.js"
import { createDiagnosticsLines } from "../src/host/diagnostics.js"
const ROOT = "http://litellm.example:4000"
const options = { pollInterval: 3600, contextTierCap: true, protocolOverrides: {}, conversationFeedback: false }
const built = buildPublicationModels(discovery, catalog, options)
const view = createRegistrationView(built.models, ROOT + "/v1")

describe("OpenCode metadata priority [T01 T10 T13 T28 T34]", () => {
  test("16 final host configurations preserve all declared fields and no extra variants", () => {
    expect(built.result.blocked).toEqual([])
    expect(view.models.map(model => String(model.id))).toEqual(oracle.models.map(model => model.id))
    for (const expected of oracle.models) {
      const model = view.models.find(item => item.id === expected.id)!
      expect(String(model.modelID)).toBe(expected.id)
      expect(model.name).toBe(expected.id)
      expect(model.capabilities).toEqual({ tools: true, input: expected.input, output: expected.output })
      expect(model.limit).toEqual({ input: 0, ...expected.limit })
      expect(String(view.protocols[expected.id])).toBe(expected.protocol)
      expect(String(view.reasoning[expected.id])).toBe(expected.reasoningSupported)
      expect(model.variants.map(variant => String(variant.id))).toEqual(expected.levels)
      expect({ input:Number(model.cost[0]!.input),output:Number(model.cost[0]!.output),cache:{read:Number(model.cost[0]!.cache.read),write:Number(model.cost[0]!.cache.write)} }).toEqual({ input: expected.cost.input ?? 0, output: expected.cost.output ?? 0, cache: { read: expected.cost.cache_read ?? 0, write: expected.cost.cache_write ?? 0 } })
      for (const variant of model.variants) expect(variant.settings).toEqual({ reasoningEffort: variant.id })
    }
  })
  test("supported-empty and unsupported preserve empty variants; tools false is explicit and unknown is withheld", () => {
    const base = built.models[0]!
    const mapped = createRegistrationView([{ ...base, reasoningSupported: "supported", variants: [], capabilities: { tools: false, input: ["image"], output: ["text"] } }, { ...base, id: "disabled", name: "disabled", reasoningSupported: "unsupported", variants: [] }], ROOT)
    expect(mapped.models[0]!.capabilities).toEqual({ tools: false, input: ["image"], output: ["text"] })
    expect(mapped.models.map(model => model.variants)).toEqual([[], []])
    expect(mapped.reasoning[base.id]).toBe("supported")
    expect(mapped.reasoning.disabled).toBe("unsupported")
    const missing = structuredClone(catalog)
    delete (missing.providers.deepseek.models["deepseek-flash"] as Record<string, unknown>).tool_call
    const result = buildPublicationModels(discovery, missing, options)
    expect(result.models.map(model => model.id)).not.toContain("deepseek-v4.1-flash")
    expect(result.result.blocked.find(item => item.spec.id === "deepseek-v4.1-flash")?.assessment.tools.state).toBe("unknown")
  })
  for (const provider of ["opencode", "openrouter"] as const) test(`official absent: maps selected ${provider} record without provider proof`, () => {
    const fallback = structuredClone(catalog)
    for (const id of Object.keys(fallback.providers)) if (id !== provider) delete (fallback.providers as Record<string, unknown>)[id]
    const result = buildPublicationModels({ data: discovery.data.filter(entry => entry.model_name === "glm-5.3") }, fallback, options)
    expect(result.result.blocked).toEqual([])
    const entry = result.result.publishable[0]!
    expect(entry.assessment.metadataSource?.providerID).toBe(provider)
    const registered = createRegistrationView(result.models, ROOT).models[0]!
    expect(String(registered.id)).toBe("glm-5.3")
    expect(registered.limit).toEqual(entry.spec.limit)
    expect(Number(registered.cost[0]!.input)).toBe(entry.spec.cost.input)
  })
})

function harness(stored?: unknown) {
  let live: unknown = discovery, metadata: unknown = catalog
  const storage = new Map<string, unknown>()
  if (stored) storage.set("litellm.discovery.snapshot.v1", JSON.stringify(stored))
  const context: SyncContext = {
    integration: { connection: { active: async () => ({ type: "credential", id: "fixture", label: "fixture", method: "key" }), resolve: async () => ({ type: "key", key: "sk-test", configuration: { url: ROOT } }) } },
    provider: { reload: async () => {} }, event: { subscribe: () => ({ [Symbol.asyncIterator]: async function* () {} }) },
    storage: { get: async key => storage.get(key), set: async (key, value) => { storage.set(key, value) } },
  }
  const snapshot: ProviderSnapshot = { ready: false, models: [] }
  const loop = createDiscoveryLoop(context, snapshot, options, { logger: { warn() {}, error() {} }, fetchLiteLLM: async () => live, getModelsDev: async () => { if (metadata instanceof Error) throw metadata; return metadata } })
  return { loop, snapshot, storage, setLive(value: unknown) { live = value }, setCatalog(value: unknown) { metadata = value } }
}

describe("OpenCode state, diagnostics and recovery [T16 T18 T19 T20 T22 T23 T31]", () => {
  test("prices do not affect publishing; outage retains original model_name despite route changes; deletion removes models", async () => {
    const h = harness()
    await h.loop.start()
    try {
      expect(h.snapshot.models).toHaveLength(16)
      const first = structuredClone(h.snapshot.models)
      const badPrices = structuredClone(catalog)
      for (const provider of Object.values(badPrices.providers)) for (const record of Object.values(provider.models)) Object.assign(record, { cost: { input: -1, output: "bad" } })
      h.setCatalog(badPrices); await h.loop.trigger(true)
      expect(h.snapshot.models.map(({ cost, ...model }) => model)).toEqual(first.map(({ cost, ...model }) => model))
      expect(h.snapshot.models.every(model => Object.values(model.cost).every(value => value === 0))).toBeTrue()
      expect(h.snapshot.diagnostics?.publication?.regressions).toEqual([])
      const changed = structuredClone(discovery)
      for (const entry of changed.data) Object.assign(entry, { litellm_params: { model: "private/changed" } })
      h.setLive(changed); h.setCatalog(new Error("catalog outage")); await h.loop.trigger(true)
      expect(h.snapshot.models).toHaveLength(16)
      expect(h.snapshot.diagnostics?.publication?.lkgIDs).toHaveLength(16)
      expect(createDiagnosticsLines(h.snapshot).join("\n")).toContain("deepseek-v4.1-flash · configured-lkg · 来源 前次配置 · 推理 low,high,max")
      h.setLive({ data: [] }); await h.loop.trigger(true)
      expect(h.snapshot.models).toEqual([])
    } finally { await h.loop.dispose() }
  })
  test("Core to snapshot to RPC/TUI diagnostics and audit retains public records, hides raw secret/URL/route", async () => {
    const h = harness(); const input = structuredClone(discovery)
    Object.assign(input.data[0]!, { litellm_params: { model: "private/secret-route", api_key: "sk-injected-secret", api_base: "http://private.invalid" } })
    h.setLive(input); await h.loop.start()
    try {
      const lines = createDiagnosticsLines(h.snapshot).join("\n")
      expect(lines).toContain("命中 16/16")
      expect(lines).toContain("来源 deepseek · 推理 low,high,max")
      expect(lines).not.toMatch(/serving|proof|models_dev_provider|候选声明|已裁决差异/)
      const audit = JSON.stringify(createAuditReport(h.snapshot.audit!))
      expect(audit).toContain('"recordKey":"deepseek-flash"')
      expect(audit).toContain('"canonicalID":"deepseek/deepseek-v4.1-flash"')
      for (const output of [audit, lines]) for (const secret of ["sk-injected-secret", "http://private.invalid", "private/secret-route"]) expect(output).not.toContain(secret)
    } finally { await h.loop.dispose() }
  })
})

describe("schema2 durable adapter restore [T19 T21]", () => {
  const saved = () => createDiscoverySnapshot(endpointFingerprint({ baseUrl: ROOT, credentialKey: "sk-test", buildOptions: options }), built.result.publishable.map(entry => entry.spec))
  test("bad reference prices restore as zero before any network result", async () => {
    const value = saved()
    for (const model of value.models) Object.assign(model.cost, { input: -1, output: "bad", cacheRead: NaN, cacheWrite: Infinity })
    const h = harness(value)
    let resolve!: (value: unknown) => void
    h.setLive(new Promise(ok => { resolve = ok }))
    const starting = h.loop.start()
    try {
      for (let i=0;i<30;i++) await Promise.resolve()
      expect(h.snapshot.models).toHaveLength(16)
      expect(h.snapshot.models.every(model => Object.values(model.cost).every(price => price === 0))).toBeTrue()
      expect(h.snapshot.diagnostics?.cache?.source).toBe("snapshot")
      expect(h.snapshot.models.map(model => model.variants)).toEqual(built.models.map(model => model.variants))
      expect((createAuditReport(h.snapshot.audit!) as { source?: string }).source).toBe("snapshot")
    } finally { resolve({ data: [] }); await starting; await h.loop.dispose() }
  })
  test("old schema, critical corruption and credential scope do not restore", async () => {
    const corrupt = saved(); corrupt.models[0]!.limit.context += 1
    for (const value of [{ ...saved(), schemaVersion: 1 }, corrupt, { ...saved(), endpointFingerprint: "different-credential-scope" }]) {
      const h = harness(value); let resolve!: (value: unknown) => void
      h.setLive(new Promise(ok => { resolve = ok })); const starting = h.loop.start()
      try { for (let i=0;i<30;i++) await Promise.resolve(); expect(h.snapshot.models).toEqual([]) }
      finally { resolve({ data: [] }); await starting; await h.loop.dispose() }
    }
  })
})
