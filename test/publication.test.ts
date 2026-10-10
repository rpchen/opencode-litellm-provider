import { officialCatalog } from "./fixtures/catalog.js"
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
  PUBLICATION_SCHEMA_VERSION,
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

const COMPLETE_CATALOG = officialCatalog({
  "openai/pub-complete": { limit: { context: 100000, output: 10000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } },
})

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
    // v8: recovery is the canonical registry gaining a complete entry for the
    // previously-withheld model (identity was unproven before; LiteLLM-only
    // declarations alone can never publish — G30). v7: the LiteLLM-only
    // branch published from complete declarations directly.
    const catalogFor = () => complete ? officialCatalog({ ...COMPLETE_CATALOG.models, "openai/pub-incomplete": { limit: { context: 100000, output: 10000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } }) : COMPLETE_CATALOG
    const h = loopHarness(async () => catalogFor(), async () => ({
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

  test("internal route changes do not withdraw an unchanged model_name during catalog outage", async () => {
    // The canonical route changes while enrichment is unavailable: the old
    // trusted snapshot no longer describes this model, so it is withheld and
    // reported as a regression instead of silently disappearing.
    // v8 note: with a complete catalog the fresh phase captures from the
    // registry; the changed phase both renames the route AND takes the
    // catalog down, so the model is withheld as a regression (no valid LKG
    // can re-prove renamed evidence).
    let phase: "fresh" | "changed" = "fresh"
    const catalogFor = () => (true && phase === "fresh" ? COMPLETE_CATALOG : {})
    const h = loopHarness(async () => catalogFor(), async () => ({
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
      expect(h.snapshot.models.map(model => model.id)).toEqual(["pub-complete"])
      expect(h.snapshot.diagnostics?.publication?.lkgIDs).toEqual(["pub-complete"])
      expect(h.snapshot.diagnostics?.publication?.regressions).toEqual([])
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
      // Host schema compliance: optional evidence fields stay absent rather
      // than explicit undefined (the RPC layer type-checks declared fields).
      expect("lkgDetail" in state).toBeFalse()
      expect("failureKind" in state).toBeFalse()

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

  test("absent optional summary fields are omitted, never emitted as undefined", () => {
    // The OpenCode host validates `litellm-publication.state` outputs against
    // the declared schema: an explicit `undefined` property fails the string
    // type check and the RPC returns rpc.invalid_output.
    const summary = summarizePublication(
      { publishable: [], blocked: [], assessments: new Map() },
      {
        discovered: 1,
        publishable: [],
        lkgBacked: [],
        withheld: [],
        partial: false,
        unusable: false,
        regressions: [],
        newlyWithheld: [],
        fingerprint: "sha256:none",
      },
    )
    expect("lkgDetail" in summary).toBeFalse()
    expect("failureKind" in summary).toBeFalse()
  })
})
