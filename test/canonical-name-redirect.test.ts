import { expect, test } from "bun:test"
import observed from "./fixtures/canonical-name-redirect.json" with { type: "json" }
import { buildPublicationResult, createDiscoverySnapshot, endpointFingerprint } from "../src/generated/discovery-core/index.js"
import { createDiscoveryLoop, type SyncContext } from "../src/host/sync.js"
import { createRegistrationView, type ProviderSnapshot } from "../src/host/register.js"
import { createDiagnosticsLines } from "../src/host/diagnostics.js"

test("[REDIRECT-HOST] fresh OpenCode discovery replaces oversized output in storage, registration and diagnostics", async () => {
  const root = "http://litellm.example:4000"
  const options = { pollInterval: 3600, contextTierCap: false, protocolOverrides: {}, conversationFeedback: false }
  const result = buildPublicationResult(observed.discovery, observed.catalog, options)
  const spec = result.publishable[0]!.spec
  const old = createDiscoverySnapshot(endpointFingerprint({ baseUrl: root, credentialKey: "sk-test", buildOptions: options }),
    [{ ...spec, limit: { ...spec.limit, output: 943718 } }])
  const storage = new Map<string, unknown>([["litellm.discovery.snapshot.v1", JSON.stringify(old)]])
  const context: SyncContext = {
    integration: { connection: {
      active: async () => ({ type: "credential", id: "fixture", label: "fixture", method: "key" }),
      resolve: async () => ({ type: "key", key: "sk-test", configuration: { url: root } }),
    } }, provider: { reload: async () => {} },
    event: { subscribe: () => ({ [Symbol.asyncIterator]: async function* () {} }) },
    storage: { get: async key => storage.get(key), set: async (key, value) => { storage.set(key, value) } },
  }
  const snapshot: ProviderSnapshot = { ready: false, models: [] }
  const loop = createDiscoveryLoop(context, snapshot, options, {
    logger: { warn() {}, error() {} }, fetchLiteLLM: async () => observed.discovery, getModelsDev: async () => observed.catalog,
  })
  await loop.start()
  try {
    const registered = createRegistrationView(snapshot.models, root + "/v1").models[0]!
    expect(String(registered.id)).toBe("deepseek-v4.1-flash")
    expect(registered.limit.context).toBe(1048576)
    expect(registered.limit.output).toBe(393216)
    expect(createDiagnosticsLines(snapshot).join("\n")).toContain("来源 deepseek")
    const saved = JSON.parse(String(storage.get("litellm.discovery.snapshot.v1")))
    expect(saved.models[0].limit.output).toBe(393216)
  } finally { await loop.dispose() }
})
