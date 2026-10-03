import { describe, expect, test } from "bun:test"
import type { ConnectionInfo } from "@opencode/client"
import { registerAudit } from "../src/host/audit-command.js"
import { createDiagnosticsLines } from "../src/host/diagnostics.js"
import { buildPublicationModels, toOpenCodeModelSpecWithPublication } from "../src/host/models.js"
import {
  acceptDegradedForSnapshot,
  summarizePublication,
} from "../src/host/publication.js"
import type { ProviderSnapshot } from "../src/host/register.js"
import { createDiscoveryLoop, type SyncContext } from "../src/host/sync.js"
import { createDiagnosticsResultStore } from "../src/tui-card.js"
import { endpointIdentity } from "../src/endpoints.js"
import type { PluginOptions } from "../src/options.js"

const COMPLETE_INFO = {
  mode: "chat",
  max_input_tokens: 100000,
  max_output_tokens: 10000,
  supports_function_calling: true,
  supports_reasoning: false,
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

function loopHarness(catalog: () => Promise<unknown>, fetch = async () => COMPLETE_RESPONSE) {
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
    storage: {
      stored: undefined as unknown,
      async get(this: { stored: unknown }) { return this.stored },
      async set(this: { stored: unknown }, _key: string, value: unknown) { this.stored = value },
    } as SyncContext["storage"],
  }
  const snapshot: ProviderSnapshot = { ready: false, models: [] }
  const loop = createDiscoveryLoop(context, snapshot, OPTIONS, {
    logger: { warn: () => {}, error: () => {} },
    fetchLiteLLM: fetch as never,
    getModelsDev: catalog as never,
  }, endpointIdentity("default", undefined, true))
  return { loop, snapshot, get reloads() { return reloads } }
}

describe("publication mapping", () => {
  test("unknown tools on degraded entries register as disabled", () => {
    const { result } = buildPublicationModels(
      { data: [{ model_name: "gap", litellm_params: { model: "openai/gap" }, model_info: { mode: "chat", max_input_tokens: 50000, max_output_tokens: 5000 } }] },
      {},
      OPTIONS,
      { acceptedDegradedIDs: new Set(["gap"]) },
    )
    const degraded = result.publishable.find((entry) => entry.spec.id === "gap")
    expect(degraded?.assessment.status).toBe("degraded")
    const mapped = toOpenCodeModelSpecWithPublication(degraded!)
    expect(mapped.capabilities.tools).toBeFalse()
  })

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
      { acceptedDegradedIDs: new Set(["zero"]) },
    )
    // Degraded with zero limits is still excluded from host registration.
    expect(models).toEqual([])
  })
})

describe("publication sync partition", () => {
  test("complete models register; incomplete never disguise as normal", async () => {
    const h = loopHarness(async () => COMPLETE_CATALOG)
    await h.loop.start()
    try {
      expect(h.snapshot.models.map((model) => model.id)).toEqual(["pub-complete"])
      const publication = h.snapshot.diagnostics?.publication
      expect(publication?.blocked.map((model) => model.id)).toEqual(["pub-incomplete"])
      expect(publication?.blocked[0]!.gaps.length).toBeGreaterThan(0)
      const lines = createDiagnosticsLines(h.snapshot).join("\n")
      expect(lines).toContain("pub-incomplete")
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

  test("blocked -> RPC accept -> degraded registration with gaps, visible in TUI lines", async () => {
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
      expect(h.snapshot.diagnostics?.publication?.blocked.map((model) => model.id)).toEqual(["gap-model"])

      const audit = auditHarness(h.snapshot)
      const registration = await registerAudit(audit.context as never, h.snapshot, {})
      const accept = audit.rpcHandlers.get("litellm-publication")!.accept as (input: unknown) => Promise<{ ok: boolean; gaps: string[] }>
      const outcome = await accept({ sessionID: "s1", modelId: "gap-model" })
      expect(outcome.ok).toBeTrue()
      expect(outcome.gaps.length).toBeGreaterThan(0)

      // Pending acceptance is immediately visible in diagnostics lines.
      const pendingLines = createDiagnosticsLines(h.snapshot).join("\n")
      expect(pendingLines).toContain("gap-model")

      // Next refresh applies the degraded path; the label stays degraded.
      await h.loop.trigger(true)
      expect(h.snapshot.models.map((model) => model.id)).toEqual(["gap-model"])
      expect(h.snapshot.diagnostics?.publication?.degradedIDs).toEqual(["gap-model"])

      const lines = createDiagnosticsLines(h.snapshot)
      expect(lines.join("\n")).toContain("gap-model")
      // The same lines flow into the TUI diagnostics store.
      const store = createDiagnosticsResultStore()
      store.accept({ sequence: 1, sessionID: "s1", lines })
      expect(store.forSession("s1")?.lines.join("\n")).toContain("gap-model")

      const summary = summarizePublication(
        { publishable: [], blocked: [] },
        undefined,
      )
      expect(summary.blocked).toEqual([])
      expect(acceptDegradedForSnapshot({ diagnostics: undefined }, "nope").accepted).toBeFalse()
      await registration.dispose()
    } finally {
      await h.loop.dispose()
    }
  })
})
