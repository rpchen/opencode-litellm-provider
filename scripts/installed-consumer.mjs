// This file is copied into the external consumer before execution. Never import the
// package from the source checkout: package self-resolution would invalidate this test.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const consumer = realpathSync(path.dirname(fileURLToPath(import.meta.url)))
const consumerManifest = JSON.parse(readFileSync(path.join(consumer, "package.json"), "utf8"))
assert.equal(consumerManifest.name, "isolated-opencode-provider-consumer", "probe must execute from the external consumer")
const input = JSON.parse(readFileSync(path.join(consumer, "verification-input.json"), "utf8"))
const installed = realpathSync(path.join(consumer, "node_modules", input.name))
function assertInside(parent, child) {
  const relative = path.relative(parent, child)
  assert(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), "module resolved outside the isolated consumer")
}
assertInside(consumer, installed)
function resolved(specifier, expected) {
  const filename = realpathSync(fileURLToPath(import.meta.resolve(specifier)))
  assertInside(consumer, filename)
  if (expected) assert.equal(filename, realpathSync(path.join(installed, expected)))
  return filename
}
function installedModule(relative) {
  return import(pathToFileURL(path.join(installed, relative)).href)
}
function distributionFiles(directory, prefix = "dist") {
  return readdirSync(directory).sort().flatMap((name) => {
    const filename = path.join(directory, name)
    const stat = lstatSync(filename)
    assert(!stat.isSymbolicLink(), "installed distribution must not use source links")
    assert(stat.isDirectory() || stat.isFile(), "installed distribution contains a non-regular entry")
    return stat.isDirectory() ? distributionFiles(filename, `${prefix}/${name}`) : [`${prefix}/${name}`]
  })
}
const files = distributionFiles(path.join(installed, "dist"))
assert.deepEqual(files.sort(), Object.keys(input.distributionDigests).sort())
for (const filename of files) {
  const digest = createHash("sha256").update(readFileSync(path.join(installed, filename))).digest("hex")
  assert.equal(digest, input.distributionDigests[filename], `installed file differs from candidate: ${filename}`)
}
for (const name of ["src", "scripts", ".tmp", ".git", "node_modules/litellm-discovery-core"]) {
  assert(!existsSync(path.join(installed, name)), "package must not contain source/build cache dependencies")
}
const manifest = JSON.parse(readFileSync(path.join(installed, "package.json"), "utf8"))
assert.equal(manifest.name, input.name)
assert.equal(manifest.version, input.version)
const provenance = JSON.parse(readFileSync(path.join(installed, "dist/core-provenance.json"), "utf8"))
assert.equal(provenance.repository, "https://github.com/rpchen/litellm-discovery-core.git")
assert.equal(provenance.branch, "main")
assert.match(provenance.sha, /^[0-9a-f]{40}$/u)

// No live service access, including during import. These are HTTP fixtures, not a
// fake @opencode/plugin package: the host SDK below is the actual npm-installed peer.
let modelRequests = 0
let catalogRequests = 0
globalThis.fetch = async (request, init) => {
  const url = request instanceof Request ? request.url : String(request)
  const headers = new Headers(init?.headers ?? (request instanceof Request ? request.headers : undefined))
  if (url === "https://litellm.example/v1/model/info") {
    assert.equal(headers.get("authorization"), "Bearer sk-fixture-only")
    modelRequests++
    return Response.json(input.litellm)
  }
  if (url === "https://models.dev/api.json") {
    assert.equal(headers.has("authorization"), false)
    catalogRequests++
    return Response.json(input.modelsDev)
  }
  throw new Error("Unexpected network access in the installed-entry probe")
}
resolved(input.name, "dist/index.js")
resolved(`${input.name}/tui`, "dist/tui.js")
resolved("@opencode/plugin")
const peer = JSON.parse(readFileSync(path.join(consumer, "node_modules/@opencode/plugin/package.json"), "utf8"))
assert.equal(peer.version, input.peerVersion)
const plugin = await import(input.name)
const tui = await import(`${input.name}/tui`)
assert.equal(plugin.PLUGIN_ID, "litellm")
assert.equal(plugin.default.id, "litellm")
assert.equal(typeof plugin.default.setup, "function")
assert.equal(tui.default.id, "litellm")
assert.equal(modelRequests + catalogRequests, 0, "import must not download core or contact discovery services")

const expectedSDKs = {
  chat: "@opencode/ai/providers/openai-compatible",
  responses: "@opencode/ai/providers/openai/responses",
  messages: "@opencode/ai/providers/anthropic",
}
const { PROTOCOL_PACKAGES } = await installedModule("dist/core/protocol.js")
assert.deepEqual(PROTOCOL_PACKAGES, expectedSDKs)
for (const specifier of Object.values(expectedSDKs)) {
  resolved(specifier)
  assert(await import(specifier))
}

function hostContext(active) {
  const state = { disposed: [], providers: [], commands: [], eventAborts: 0, integration: { id: "litellm", name: "old" } }
  let transform
  let ready
  state.ready = new Promise((resolve) => { ready = resolve })
  const registration = (kind) => ({ dispose: async () => { state.disposed.push(kind) } })
  const editor = { add: (provider) => { state.providers.push(provider); ready(provider) } }
  const connection = { type: "credential", id: "fixture-connection", label: "fixture", method: "key" }
  const context = {
    options: { pollInterval: 30 },
    integration: {
      transform: async (callback) => {
        callback({
          update: (id, update) => { assert.equal(id, "litellm"); update(state.integration) },
          method: { update: (method) => { state.method = method } },
        })
        return registration("integration")
      },
      connection: {
        active: async () => active ? connection : undefined,
        resolve: async () => ({ type: "key", key: "sk-fixture-only", configuration: { url: "https://litellm.example" } }),
      },
    },
    provider: {
      transform: async (callback) => { transform = callback; callback(editor); return registration("provider") },
      reload: async () => { transform(editor) },
    },
    rpc: { register: async () => ({ ...registration("rpc"), events: { emit: async () => {} } }) },
    command: { transform: async (callback) => { callback({ add: (value) => { state.commands.push(value.name) } }); return registration("command") } },
    event: {
      subscribe: ({ signal }) => ({
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise((resolve) => {
            const finish = () => { state.eventAborts++; resolve({ value: undefined, done: true }) }
            if (signal.aborted) finish()
            else signal.addEventListener("abort", finish, { once: true })
          }),
        }),
      }),
    },
  }
  return { context, state }
}

const disconnected = hostContext(false)
const closeDisconnected = await plugin.default.setup(disconnected.context)
assert.equal(typeof closeDisconnected, "function")
await closeDisconnected()
assert.equal(disconnected.state.integration.name, "LiteLLM")
assert.equal(disconnected.state.providers.length, 0)
assert.equal(disconnected.state.commands.length, 3)
assert.deepEqual(disconnected.state.commands.sort(), ["litellm-audit-export", "litellm-diagnostics", "litellm-endpoints"])
assert.equal(disconnected.state.eventAborts, 1)
assert.deepEqual(disconnected.state.disposed.sort(), ["command", "command", "integration", "provider", "rpc", "rpc"])
assert.equal(modelRequests + catalogRequests, 0)

const connected = hostContext(true)
const closeConnected = await plugin.default.setup(connected.context)
let deadline
try {
  const registration = await Promise.race([
    connected.state.ready,
    new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("installed plugin did not initialize models")), 5000) }),
  ])
  assert.equal(registration.info.id, "litellm")
  assert.equal(registration.info.package, expectedSDKs.chat)
  assert.equal(registration.info.settings.baseURL, "https://litellm.example/v1")
  assert.equal(registration.models.length, 10)
  assert.equal(Object.isFrozen(registration.models), true)
  assert.equal(JSON.stringify(registration).includes("sk-fixture-only"), false)
  const models = new Map(registration.models.map((model) => [model.id, model]))
  const gpt = models.get("gpt-5.5")
  assert(gpt)
  assert.equal(gpt.package, expectedSDKs.responses)
  assert.deepEqual(gpt.limit, { context: 272000, input: 272000, output: 64000 })
  assert.deepEqual(gpt.cost, [{ input: 2.5, output: 10, cache: { read: 0.25, write: 3 } }])
  assert.deepEqual(gpt.capabilities, { tools: true, input: ["text", "image", "pdf"], output: ["text"] })
  assert.deepEqual(gpt.variants.find((variant) => variant.id === "high")?.settings, { reasoningEffort: "high" })
  assert.equal(gpt.time.released, Date.parse("2026-03-01"))
  assert.equal(models.get("glm-5.3")?.package, expectedSDKs.chat)
  assert.equal(models.get("claude-db")?.package, expectedSDKs.messages)
  assert.deepEqual(models.get("claude-db")?.variants.find((variant) => variant.id === "max")?.settings,
    { thinking: { type: "enabled", budgetTokens: 64000 } })
  assert.equal(models.has("text-embedding-v4"), false)
  assert.equal(modelRequests, 1)
  assert.equal(catalogRequests, 1)
} finally {
  clearTimeout(deadline)
  await closeConnected()
}
assert.deepEqual(connected.state.disposed.sort(), ["command", "command", "integration", "provider", "rpc", "rpc"])
assert.equal(connected.state.eventAborts, 1)
const { buildModelSpecs } = await installedModule("dist/generated/discovery-core/index.js")
assert(buildModelSpecs(input.litellm, input.modelsDev, { contextTierCap: true, protocolOverrides: {} })
  .every((model) => !Object.hasOwn(model, "package")))
const { createAuditResultStore } = await installedModule("dist/tui-card.js")
const store = createAuditResultStore()
store.accept({ sequence: 1, sessionID: "smoke", ok: true, path: "C:/audit/report.json", error: "" })
assert.equal(store.forSession("smoke")?.path, "C:/audit/report.json")
console.log(`Installed-entry contract passed: real @opencode/plugin ${peer.version}; simulated host context and fixture HTTP; 10 models, 3 SDKs, both entry points`)
