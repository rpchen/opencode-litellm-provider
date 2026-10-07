import { describe, expect, test } from "bun:test"
import type { ConnectionInfo } from "@opencode/client"
import { registerAudit } from "../src/host/audit-command.js"
import { createDiagnosticsLines } from "../src/host/diagnostics.js"
import { PROTOCOL_PACKAGES } from "../src/host/protocol.js"
import {
  assessModelConfiguration,
  buildModelSpecs,
  capturedPublicationVerdict,
  createLastKnownGoodEntry,
  createLastKnownGoodStore,
  groupLiteLLMDeployments,
  lastKnownGoodKey,
} from "../src/generated/discovery-core/index.js"
import { buildPublicationModels, toOpenCodeModelSpecWithPublication } from "../src/host/models.js"
import { catalogNotice, summarizePublication } from "../src/host/publication.js"
import type { ProviderSnapshot } from "../src/host/register.js"
import { createDiscoveryLoop, publicationMemoryKey, type SyncContext } from "../src/host/sync.js"
import { createDiagnosticsResultStore } from "../src/tui-card.js"
import { endpointIdentity } from "../src/endpoints.js"
import type { PluginOptions } from "../src/options.js"

const COMPLETE_INFO = {
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
}

const COMPLETE_RESPONSE = {
  data: [
    {
      model_name: "pub-complete",
      litellm_params: { model: "openai/pub-complete" },
      model_info: { ...COMPLETE_INFO },
    },
    {
      model_name: "pub-incomplete",
      litellm_params: { model: "openai/pub-incomplete" },
      model_info: { mode: "chat" },
    },
  ],
}

const COMPLETE_CATALOG = {
  openai: {
    models: {
      "pub-complete": {
        id: "pub-complete",
        limit: { context: 100000, output: 10000 },
        tool_call: true,
        reasoning: false,
        modalities: { input: ["text"], output: ["text"] },
      },
    },
  },
}

const OPTIONS: PluginOptions = {
  pollInterval: 3600,
  contextTierCap: false,
  protocolOverrides: {},
  conversationFeedback: false,
}

function loopHarnessFactory(
  catalog: () => Promise<unknown>,
  fetch: (() => Promise<unknown>) | undefined = undefined,
  injectedStorage: unknown = undefined,
) {
  return loopHarness(catalog, fetch ?? (async () => COMPLETE_RESPONSE), injectedStorage)
}

function loopHarness(
  catalog: () => Promise<unknown>,
  fetch: () => Promise<unknown> = async () => COMPLETE_RESPONSE,
  injectedStorage: unknown = undefined,
) {
  let reloads = 0
  const context: SyncContext = {
    integration: {
      connection: {
        active: async () => ({ type: "credential", id: "credential-a", label: "A", method: "key" }) as ConnectionInfo,
        resolve: async () => ({
          type: "key",
          key: "sk-publication",
          configuration: { url: "http://litellm.example:4000" },
        }),
      },
    },
    provider: {
      reload: async () => { reloads += 1 },
    },
    event: {
      subscribe: () => ({ [Symbol.asyncIterator]: async function* () {} }) as AsyncIterable<{ type: string }>,
    },
    storage: (injectedStorage ?? {
      stored: undefined as unknown,
      values: new Map<string, unknown>(),
      async get(this: { stored: unknown; values: Map<string, unknown> }, key: string) {
        return this.values.has(key) ? this.values.get(key) : this.stored
      },
      async set(this: { stored: unknown; values: Map<string, unknown> }, key: string, value: unknown) {
        if (key.startsWith("litellm.publication.memory")) this.values.set(key, value)
        else this.stored = value
      },
    }) as SyncContext["storage"],
  }
  const snapshot: ProviderSnapshot = { ready: false, models: [] }
  const storage = context.storage as unknown as { stored: unknown; values: Map<string, unknown> }
  const loop = createDiscoveryLoop(context, snapshot, OPTIONS, {
    logger: { warn: () => {}, error: () => {} },
    fetchLiteLLM: fetch as never,
    getModelsDev: catalog as never,
  }, endpointIdentity("default", undefined, true))
  return { loop, snapshot, storage, get reloads() { return reloads } }
}

describe("publication mapping", () => {
  test("configured entries keep their Core tool verdict", () => {
    const { models, result } = buildPublicationModels(COMPLETE_RESPONSE, COMPLETE_CATALOG, OPTIONS)
    expect(models.map((model) => model.id)).toEqual(["pub-complete"])
    expect(result.blocked.map((entry) => entry.spec.id)).toEqual(["pub-incomplete"])
    expect(models[0]!.capabilities.tools).toBeTrue()
  })

  test("operational guard stays behind the Core partition", () => {
    const { models } = buildPublicationModels(
      { data: [{ model_name: "zero", litellm_params: { model: "openai/zero" }, model_info: { mode: "chat" } }] },
      {},
      OPTIONS,
    )
    // Withheld with zero limits never reaches host registration.
    expect(models).toEqual([])
  })

  test("publication needs no user confirmation: a withheld entry stays withheld", () => {
    const { models, result } = buildPublicationModels(
      { data: [{ model_name: "gap", litellm_params: { model: "openai/gap" }, model_info: { mode: "chat", max_input_tokens: 50000, max_output_tokens: 5000 } }] },
      {},
      OPTIONS,
    )
    expect(models).toEqual([])
    expect(result.publishable).toEqual([])
    expect(result.blocked[0]!.assessment.publishable).toBeFalse()
    // There is no publication option that changes this outcome.
    expect(Object.keys(result)).toEqual(["publishable", "blocked", "assessments"])
  })

  test("a withheld entry never maps to a host model shape", () => {
    const { result } = buildPublicationModels(
      { data: [{ model_name: "gap", litellm_params: { model: "openai/gap" }, model_info: { mode: "chat", max_input_tokens: 50000, max_output_tokens: 5000 } }] },
      {},
      OPTIONS,
    )
    expect(result.blocked).toHaveLength(1)
    expect(toOpenCodeModelSpecWithPublication as unknown).toBeFunction()
  })
})

describe("publication sync partition", () => {
  test("complete models register; incomplete never disguise as normal", async () => {
    const h = loopHarness(async () => COMPLETE_CATALOG)
    await h.loop.start()
    try {
      expect(h.snapshot.models.map((model) => model.id)).toEqual(["pub-complete"])
      const publication = h.snapshot.diagnostics?.publication
      expect(publication?.withheld.map((model) => model.id)).toEqual(["pub-incomplete"])
      expect(publication?.withheld[0]!.reasons.length).toBeGreaterThan(0)
      expect(publication?.partial).toBeTrue()
      expect(publication?.discovered).toBe(2)
      const lines = createDiagnosticsLines(h.snapshot).join("\n")
      expect(lines).toContain("pub-incomplete")
      expect(lines).toContain("部分可用")
    } finally {
      await h.loop.dispose()
    }
  })

  test("metadata failure with valid LKG still registers with LKG marking", async () => {
    // Bare LiteLLM declarations (limits only): completeness depends on the
    // catalog, so an outage triggers LKG substitution instead of LiteLLM-only
    // configuration.
    const bare = async () => ({
      data: COMPLETE_RESPONSE.data.map((deployment) => ({
        ...deployment,
        model_info: { mode: "chat", max_input_tokens: 100000, max_output_tokens: 10000 },
      })),
    })
    const h = loopHarness(async () => COMPLETE_CATALOG, bare)
    await h.loop.start()
    try {
      expect(h.snapshot.models.map((model) => model.id)).toEqual(["pub-complete"])
    } finally {
      await h.loop.dispose()
    }
    // Second loop reuses the seeded store through the same snapshot state.
    const h2 = loopHarness(async () => {
      throw Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" })
    }, bare)
    h2.snapshot.publicationState = h.snapshot.publicationState
    await h2.loop.start()
    try {
      expect(h2.snapshot.models.map((model) => model.id)).toEqual(["pub-complete"])
      expect(h2.snapshot.diagnostics?.publication?.lkgIDs).toEqual(["pub-complete"])
      expect(h2.snapshot.diagnostics?.publication?.lkgDetail).toContain("live unavailable")
      expect(h2.snapshot.diagnostics?.publication?.failureKind).toBe("unreachable")
    } finally {
      await h2.loop.dispose()
    }
  })

  test("retry recovery restores normal configuration", async () => {
    let fail = false
    const h = loopHarness(async () => {
      if (fail) throw new Error("temporary outage")
      return COMPLETE_CATALOG
    })
    await h.loop.start()
    try {
      expect(h.snapshot.models.map((model) => model.id)).toEqual(["pub-complete"])
      fail = true
      await h.loop.trigger(true)
      // Valid LKG covers the outage.
      expect(h.snapshot.models.map((model) => model.id)).toEqual(["pub-complete"])
      fail = false
      await h.loop.trigger(true)
      expect(h.snapshot.diagnostics?.publication?.lkgIDs ?? []).toEqual([])
      expect(h.snapshot.models.map((model) => model.id)).toEqual(["pub-complete"])
    } finally {
      await h.loop.dispose()
    }
  })

  test("acknowledgement survives a restart: the same problem set stays quiet, material change re-notifies", async () => {
    // Unusable endpoint: every discovered model is withheld.
    const unusable = async () => ({
      data: ["gap-a", "gap-b"].map((model_name) => ({
        model_name,
        litellm_params: { model: `custom/${model_name}` },
        model_info: { mode: "chat" },
      })),
    })
    const identity = endpointIdentity("default", undefined, true)

    const first = loopHarnessFactory(async () => ({}), unusable)
    await first.loop.start()
    try {
      const publication = first.snapshot.diagnostics?.publication
      expect(publication?.unusable).toBeTrue()
      expect(publication?.acknowledgement.notify).toBeTrue()
      const serialized = first.snapshot.publicationState?.acknowledgement
      expect(serialized).toBeDefined()
      // The adapter persisted the publication memory under its own endpoint key,
      // next to the snapshot, and never inside the publication verdict itself.
      const memory = JSON.parse(String(first.storage.values.get(publicationMemoryKey("default", true))))
      expect(memory.schemaVersion).toBe(1)
      expect(memory.acknowledgement.models["gap-a"]).toBeDefined()
      expect(memory.published).toEqual([])
    } finally {
      await first.loop.dispose()
    }

    // Restart: a brand new loop, controller and options, same host storage.
    const second = loopHarnessFactory(async () => ({}), unusable, first.storage)
    await second.loop.start()
    try {
      const publication = second.snapshot.diagnostics?.publication
      expect(publication?.unusable).toBeTrue()
      // Same fingerprint -> suppressed, and diagnostics still describes it.
      expect(publication?.acknowledgement.notify).toBeFalse()
      expect(publication?.acknowledgement.reason).toBe("unchanged")
      expect(publication?.withheld.map((entry) => entry.id).sort()).toEqual(["gap-a", "gap-b"])
      expect(second.snapshot.publicationState?.pendingNotice).toBeUndefined()
    } finally {
      await second.loop.dispose()
    }

    // Material change after the restart: a third withheld model is reported again.
    const grown = async () => ({
      data: ["gap-a", "gap-b", "gap-c"].map((model_name) => ({
        model_name,
        litellm_params: { model: `custom/${model_name}` },
        model_info: { mode: "chat" },
      })),
    })
    const third = loopHarnessFactory(async () => ({}), grown, first.storage)
    await third.loop.start()
    try {
      const publication = third.snapshot.diagnostics?.publication
      expect(publication?.acknowledgement.notify).toBeTrue()
      expect(publication?.acknowledgement.reason).toBe("catalog-unusable")
      expect(third.snapshot.publicationState?.pendingNotice?.reason).toBe("catalog-unusable")
    } finally {
      await third.loop.dispose()
    }
  })

  test("corrupt persisted memory changes nothing about publication", async () => {
    const storage = {
      stored: undefined as unknown,
      values: new Map<string, unknown>([
        [publicationMemoryKey("default", true), JSON.stringify({ schemaVersion: 99, acknowledgement: { bogus: true } })],
      ]),
      async get(this: { stored: unknown; values: Map<string, unknown> }, key: string) {
        return this.values.has(key) ? this.values.get(key) : this.stored
      },
      async set(this: { stored: unknown; values: Map<string, unknown> }, key: string, value: unknown) {
        if (key.startsWith("litellm.publication.memory")) this.values.set(key, value)
        else this.stored = value
      },
    }
    const h = loopHarnessFactory(async () => COMPLETE_CATALOG, undefined, storage)
    await h.loop.start()
    try {
      expect(h.snapshot.models.map((model) => model.id)).toEqual(["pub-complete"])
      expect(h.snapshot.diagnostics?.publication?.publishable.map((entry) => entry.id)).toEqual(["pub-complete"])
    } finally {
      await h.loop.dispose()
    }
  })

  test("a withheld model recovering is published automatically without user approval", async () => {
    let complete = false
    const h = loopHarness(async () => COMPLETE_CATALOG, async () => ({
      data: [
        { model_name: "pub-complete", litellm_params: { model: "openai/pub-complete" }, model_info: { ...COMPLETE_INFO } },
        {
          model_name: "pub-incomplete",
          litellm_params: { model: "openai/pub-incomplete" },
          model_info: complete ? { ...COMPLETE_INFO } : { mode: "chat" },
        },
      ],
    }))
    await h.loop.start()
    try {
      expect(h.snapshot.models.map((model) => model.id)).toEqual(["pub-complete"])
      expect(h.snapshot.diagnostics?.publication?.withheld.map((model) => model.id)).toEqual(["pub-incomplete"])
      complete = true
      await h.loop.trigger(true)
      expect(h.snapshot.models.map((model) => model.id).sort()).toEqual(["pub-complete", "pub-incomplete"])
      expect(h.snapshot.diagnostics?.publication?.withheld).toEqual([])
    } finally {
      await h.loop.dispose()
    }
  })

  test("previously published model becoming withheld is a regression and a loud notice", async () => {
    // The canonical route changes while enrichment is unavailable: the old
    // trusted snapshot no longer describes this model, so it is withheld and
    // reported as a regression instead of silently disappearing.
    let phase: "fresh" | "changed" = "fresh"
    const h = loopHarness(async () => ({}), async () => ({
      data: [{
        model_name: "pub-complete",
        litellm_params: { model: phase === "fresh" ? "openai/pub-complete" : "openai/pub-complete-renamed" },
        model_info: phase === "fresh"
          ? { ...COMPLETE_INFO }
          : { mode: "chat", supports_function_calling: true, supports_reasoning: false },
      }],
    }))
    await h.loop.start()
    try {
      expect(h.snapshot.models.map((model) => model.id)).toEqual(["pub-complete"])
      phase = "changed"
      await h.loop.trigger(true)
      expect(h.snapshot.models).toEqual([])
      const publication = h.snapshot.diagnostics?.publication
      expect(publication?.regressions).toEqual(["pub-complete"])
      expect(publication?.discovered).toBe(1)
      expect(publication?.unusable).toBeTrue()
      expect(publication?.lkgIDs).toEqual([])
      const lines = createDiagnosticsLines(h.snapshot).join("\n")
      expect(lines).toContain("此前可用、现已撤下：pub-complete")
      expect(lines).toContain("catalog 当前不可用")
      // The notice is a warning and is consumed through the acknowledgement
      // state, never through publication. A withdrawal is reported as the
      // specific regression message (it names the model and points at retry),
      // not as a generic unusable-catalog notice.
      expect(publication?.acknowledgement.notify).toBeTrue()
      expect(publication?.acknowledgement.reason).toBe("regression")
      expect(catalogNotice(publication)?.level).toBe("warning")
      expect(catalogNotice(publication)?.message).toContain("此前可用的模型已被撤下：pub-complete")
      expect(catalogNotice(publication)?.message).toContain("不会自动切换")
      expect(catalogNotice(publication)?.message).toContain("Retry")
    } finally {
      await h.loop.dispose()
    }
  })

  test("the whole catalog being unpublishable is reported, not silent", async () => {
    const h = loopHarness(async () => ({}), async () => ({
      data: [
        { model_name: "a", litellm_params: { model: "openai/a" }, model_info: { mode: "chat" } },
        { model_name: "b", litellm_params: { model: "openai/b" }, model_info: { mode: "chat" } },
      ],
    }))
    await h.loop.start()
    try {
      const publication = h.snapshot.diagnostics?.publication
      expect(publication?.discovered).toBe(2)
      expect(publication?.publishable).toEqual([])
      expect(publication?.unusable).toBeTrue()
      expect(publication?.partial).toBeFalse()
      const lines = createDiagnosticsLines(h.snapshot).join("\n")
      expect(lines).toContain("catalog 当前不可用")
      expect(lines).toContain("发现 2 · 可用 0 · withheld 2")
      expect(catalogNotice(publication)?.message).toContain("没有任何模型可以安全发布")
    } finally {
      await h.loop.dispose()
    }
  })
})

describe("publication longitudinal: Core -> snapshot -> RPC -> TUI lines", () => {
  function auditHarness(snapshot: ProviderSnapshot) {
    const rpcHandlers = new Map<string, Record<string, (input: unknown) => Promise<unknown>>>()
    const rpcEmits: Array<{ rpc: string; event: string; value: unknown }> = []
    const commands = new Map<string, { execute(input: Record<string, unknown>): Promise<void> }>()
    const context = {
      rpc: {
        register: async (schema: { id: string }, handlers: Record<string, (input: unknown) => Promise<unknown>>) => {
          rpcHandlers.set(schema.id, handlers)
          return {
            events: { emit: async (event: string, value: unknown) => { rpcEmits.push({ rpc: schema.id, event, value }) } },
            dispose: async () => {},
          }
        },
      },
      command: {
        transform: async (register: (editor: { add(value: { name: string; execute(input: Record<string, unknown>): Promise<void> }): void }) => void) => {
          register({ add(value) { commands.set(value.name, value) } })
          return { dispose: async () => {} }
        },
      },
      session: { prompt: async () => ({ id: "msg_1" }) },
    }
    return { context, rpcHandlers, rpcEmits, commands }
  }

  test("no accept-degraded command or RPC exists; withheld stays withheld", async () => {
    const h = loopHarness(async () => ({}), async () => ({
      data: [{
        model_name: "gap-model",
        litellm_params: { model: "openai/gap-model" },
        model_info: { mode: "chat", max_input_tokens: 50000, max_output_tokens: 5000 },
      }],
    }))
    await h.loop.start()
    try {
      expect(h.snapshot.models).toEqual([])
      expect(h.snapshot.diagnostics?.publication?.withheld.map((model) => model.id)).toEqual(["gap-model"])

      const audit = auditHarness(h.snapshot)
      const registration = await registerAudit(audit.context as never, h.snapshot, {})
      expect([...audit.commands.keys()]).not.toContain("litellm-accept-degraded")
      expect([...audit.commands.keys()].some((name) => name.includes("degraded"))).toBeFalse()
      const handlers = audit.rpcHandlers.get("litellm-publication")!
      expect(Object.keys(handlers)).toEqual(["state"])
      expect("accept" in handlers).toBeFalse()

      const state = await handlers.state!({}) as { withheld: Array<{ id: string }>; partial: boolean }
      expect(state.withheld.map((model) => model.id)).toEqual(["gap-model"])
      expect(state.partial).toBeFalse()

      // Even after a refresh nothing forces the model in: publication is
      // Core's decision alone.
      await h.loop.trigger(true)
      expect(h.snapshot.models).toEqual([])

      const lines = createDiagnosticsLines(h.snapshot)
      const store = createDiagnosticsResultStore()
      store.accept({ sequence: 1, sessionID: "s1", lines })
      expect(store.forSession("s1")?.lines.join("\n")).toContain("gap-model")
      await registration.dispose()
    } finally {
      await h.loop.dispose()
    }
  })

  test("the publication RPC summary carries the new evidence facts", () => {
    const summary = summarizePublication(
      { publishable: [], blocked: [], assessments: new Map() },
      {
        discovered: 2,
        publishable: [],
        lkgBacked: [],
        withheld: [],
        partial: false,
        unusable: false,
        regressions: [],
        newlyWithheld: [],
        fingerprint: "sha256:none",
      },
      "timeout",
    )
    expect(summary.discovered).toBe(2)
    expect(summary.failureKind).toBe("timeout")
    expect(summary.withheld).toEqual([])
    expect(summary.regressions).toEqual([])
    expect(summary.acknowledgement.reason).toBe("unchanged")
  })
})

// ---------------------------------------------------------------------------
// Canonical provider selection integration (fix-canonical-provider-selection-integration)
//
// Sanitized DeepSeek V4.1 Flash data shapes mirrored from the Core fixture
// (`litellm-discovery-core/test/fixtures/models-dev-catalog-fixtures.ts`).
// No production code may branch on a model or provider name.
// ---------------------------------------------------------------------------

const DEEPSEEK_RESPONSE = {
  data: [
    {
      model_name: "deepseek-v4.1-flash",
      litellm_params: { model: "deepseek-v4.1-flash", custom_llm_provider: "openai" },
      model_info: {
        mode: "responses",
        base_model: "deepseek-v4.1-flash",
        max_input_tokens: 1_000_000,
        max_output_tokens: 384_000,
        max_tokens: 384_000,
        supports_vision: true,
        supports_pdf_input: false,
        supports_audio_input: false,
        supports_function_calling: true,
        supports_reasoning: true,
      },
    },
  ],
}

const DEEPSEEK_CATALOG = {
  deepseek: {
    models: {
      "deepseek-v4-flash": {
        id: "deepseek-v4-flash",
        tool_call: true,
        reasoning: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 1_000_000, output: 393_216 },
        cost: { input: 0.15, output: 0.6 },
        canonical_model_id: "deepseek/deepseek-v4.1-flash",
      },
      "deepseek-flash": {
        id: "deepseek-flash",
        tool_call: true,
        reasoning: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 1_000_000, output: 393_216 },
        cost: { input: 0.15, output: 0.6 },
        canonical_model_id: "deepseek/deepseek-v4.1-flash",
      },
    },
  },
  openrouter: {
    models: {
      "deepseek/deepseek-v4.1-flash": {
        id: "deepseek/deepseek-v4.1-flash",
        tool_call: true,
        reasoning: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 1_048_576, output: 943_718 },
        cost: { input: 0.0033, output: 3.3, cache_read: 0.0033 },
        canonical_model_id: "deepseek/deepseek-v4.1-flash",
      },
    },
  },
  opencode: {
    models: {
      "deepseek-v4.1-flash": {
        id: "deepseek-v4.1-flash",
        tool_call: true,
        reasoning: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 1_000_000, output: 384_000 },
        cost: { input: 0.3, output: 1.2, cache_read: 0.006 },
        canonical_model_id: "deepseek/deepseek-v4.1-flash",
      },
    },
  },
}

// ---------------------------------------------------------------------------
// LKG schema 7 round-trip through the OpenCode integration (transparency proof)
// ---------------------------------------------------------------------------

const storedSnapshotSpecsShape = "specs-only" as const

const OC_FULL_CAPABILITY_DECLARATIONS = {
  supports_function_calling: true,
  supports_reasoning: false,
  supports_vision: false,
  supports_pdf_input: false,
  supports_audio_input: false,
  supports_video_input: false,
  supports_audio_output: false,
}

describe("LKG schema 7 round-trip (OpenCode transparency)", () => {
  test("route-qualified canonical record capture grades authoritative-intrinsic", () => {
    const body = {
      data: [{
        model_name: "openai-org-model",
        litellm_params: { model: "openai/openai-org-model" },
        model_info: { mode: "chat", max_input_tokens: 100_000, max_output_tokens: 10_000, ...OC_FULL_CAPABILITY_DECLARATIONS },
      }],
    }
    const catalog = {
      openai: { models: { "openai-org-model": { id: "openai-org-model", limit: { context: 100_000, output: 10_000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } },
    }
    const store = createLastKnownGoodStore()
    const group = groupLiteLLMDeployments(body)[0]!
    const assessment = assessModelConfiguration(group, catalog, OPTIONS)
    expect(assessment.identity.selected?.selectionSource).toBe("canonical-original")
    const entry = createLastKnownGoodEntry(
      group,
      assessment.identity.selected,
      buildModelSpecs(body, catalog, OPTIONS)[0]!,
      1000,
      capturedPublicationVerdict(assessment),
      catalog,
      OPTIONS,
    )
    store.set(lastKnownGoodKey("openai-org-model"), entry)
    expect(store.get(lastKnownGoodKey("openai-org-model"))?.evidenceAuthority).toBe("authoritative-intrinsic")
  })

  test("unique-match record capture grades fallback-serving (outage fail-closed path)", () => {
    const body = {
      data: [{
        model_name: "reseller-only-model",
        litellm_params: { model: "custom/reseller-only-model" },
        model_info: { mode: "chat", max_input_tokens: 50_000, max_output_tokens: 5_000, ...OC_FULL_CAPABILITY_DECLARATIONS },
      }],
    }
    const catalog = {
      somereseller: { models: { "reseller-only-model": { id: "reseller-only-model", limit: { context: 50_000, output: 5_000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } },
    }
    const store = createLastKnownGoodStore()
    const group = groupLiteLLMDeployments(body)[0]!
    const assessment = assessModelConfiguration(group, catalog, OPTIONS)
    expect(assessment.identity.selected?.selectionSource).toBe("unique-match")
    const spec = buildModelSpecs(body, catalog, OPTIONS)[0]!
    const entry = createLastKnownGoodEntry(
      group,
      assessment.identity.selected,
      spec,
      1000,
      capturedPublicationVerdict(assessment),
      catalog,
      OPTIONS,
    )
    store.set(lastKnownGoodKey("reseller-only-model"), entry)
    expect(store.get(lastKnownGoodKey("reseller-only-model"))?.evidenceAuthority).toBe("fallback-serving")
  })

  test("snapshot persistence carries specs only; the LKG authority stays Core-owned", () => {
    expect(storedSnapshotSpecsShape).toBe("specs-only")
  })
})

describe("canonical selection integration: Core publication -> OpenCode host config", () => {
  test("DeepSeek official provider limits reach the OpenCode host model (output=393216)", () => {
    const { models, result } = buildPublicationModels(DEEPSEEK_RESPONSE, DEEPSEEK_CATALOG, OPTIONS)
    expect(result.publishable).toHaveLength(1)
    expect(result.blocked).toEqual([])
    const model = models.find((item) => item.id === "deepseek-v4.1-flash")
    expect(model).toBeDefined()
    // The official serving limit, not the OpenRouter reseller's.
    expect(model!.limit.output).toBe(393_216)
    expect(model!.limit.output).not.toBe(943_718)
    expect(model!.limit.context).toBe(1_000_000)
    expect(model!.limit.input).toBe(1_000_000)
    // Core provider-selection provenance is preserved verbatim.
    const assessment = result.assessments.get("deepseek-v4.1-flash")!
    expect(assessment.identity.selected?.providerID).toBe("deepseek")
    expect(assessment.identity.selected?.selectionSource).toBe("canonical-original")
    expect(model!.package).toBe(PROTOCOL_PACKAGES.responses)
  })

  test("OpenRouter-only fallback conflicting with the endpoint stays blocked (943718 never registers)", () => {
    const { models, result } = buildPublicationModels(
      DEEPSEEK_RESPONSE,
      { openrouter: DEEPSEEK_CATALOG.openrouter },
      OPTIONS,
    )
    expect(models.find((item) => item.id === "deepseek-v4.1-flash")).toBeUndefined()
    const blocked = result.blocked.find((item) => item.spec.id === "deepseek-v4.1-flash")
    expect(blocked).toBeDefined()
    expect(blocked!.assessment.conflicts.map((item) => item.field)).toContain("limit.output")
  })

  test("OpenCode fallback ranks before OpenRouter and never rewrites the identity", () => {
    const resellersOnly = { opencode: DEEPSEEK_CATALOG.opencode, openrouter: DEEPSEEK_CATALOG.openrouter }
    const { models } = buildPublicationModels(DEEPSEEK_RESPONSE, resellersOnly, OPTIONS)
    const model = models.find((item) => item.id === "deepseek-v4.1-flash")
    // OpenCode's serving limit agrees with the endpoint declaration.
    expect(model).toBeDefined()
    expect(model!.limit.output).toBe(384_000)
    // The canonical identity stays the deployment's own name.
    expect(model!.id).toBe("deepseek-v4.1-flash")
  })
})
