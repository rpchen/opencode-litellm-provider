import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createEndpointManagement } from "../src/host/endpoint-manager.js"
import { readPluginOptions } from "../src/host/config-file.js"
import { parseOptions, type PluginOptions } from "../src/options.js"
import { activeEndpointIds, type EndpointActivation } from "../src/endpoints.js"

const PKG = "github:rpchen/opencode-litellm-provider#v0.4.3"
const file = (endpoints?: Record<string, unknown>, extra = "") => `{
  // user comment
  "plugins": [{ "package": "${PKG}", "options": { "pollInterval": 90${endpoints ? `, "endpoints": ${JSON.stringify(endpoints)}` : ""}${extra} } }]
}
`

function host(content: string, opts: { legacyUrl?: string; inlineOptions?: unknown; write?: { rename?: (from: string, to: string) => void; beforeCommit?: () => void } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "oc-mgr-"))
  const target = { file: join(dir, "opencode.jsonc") }
  writeFileSync(target.file, content)
  let options: PluginOptions = parseOptions(opts.inlineOptions ?? readPluginOptions(target, PKG), { warn() {} })
  let activation: EndpointActivation = { mode: "all" }
  const removed: string[] = []
  const events: string[] = []
  const ids = () => options.endpoints === undefined ? ["default"] : Object.keys(options.endpoints)
  const manager = createEndpointManagement({
    env: {},
    target,
    options: () => options,
    ids,
    activation: () => activation,
    async setActivation(next) { activation = next; events.push(`activation:${JSON.stringify(next)}`) },
    async rebuild(next) { options = next; events.push("rebuild") },
    async legacyBaseUrl() { return opts.legacyUrl },
    async removeStorage(key) { removed.push(key) },
    async sourceTarget() { return PKG },
    write: opts.write,
  })
  return { manager, target, text: () => readFileSync(target.file, "utf8"), removed, events, get activation() { return activation }, get options() { return options }, active: () => activeEndpointIds(ids(), activation) }
}

const TWO = { default: { baseUrl: "https://a.example" }, company: { baseUrl: "https://b.example", protocolOverrides: { m: "messages" } } }

describe("endpoint manager (server)", () => {
  test("[LIST-SINGLE][LIST-MULTI] lists explicit endpoints with active state", async () => {
    const h = host(file(TWO))
    await h.manager.refresh?.()
    expect(h.manager.endpoints()).toEqual([
      { id: "default", baseUrl: "https://a.example", active: true, legacy: false },
      { id: "company", baseUrl: "https://b.example", active: true, legacy: false },
    ])
    expect(h.manager.writable().writable).toBe(true)
  })

  test("[LIST-EMPTY][LIST-LEGACY-GHOST] explicit empty endpoints lists nothing; legacy lists default only when its address exists", async () => {
    const empty = host(file({}))
    await empty.manager.refresh?.()
    expect(empty.manager.endpoints()).toEqual([])
    // legacy with a connected address → the default endpoint is listed with its address
    const legacy = host(file(), { legacyUrl: "https://old.example" })
    await legacy.manager.refresh?.()
    expect(legacy.manager.endpoints()).toEqual([{ id: "default", baseUrl: "https://old.example", active: true, legacy: true }])
    expect(legacy.manager.writable().legacyMigration).toBe(true)
    // legacy without any connection/URL → no ghost default row; the user just adds endpoints
    const ghostless = host(file())
    await ghostless.manager.refresh?.()
    expect(ghostless.manager.endpoints()).toEqual([])
  })

  test("[LIST-EXTERNAL] a hand edit of the file is synced into the running options on refresh", async () => {
    const h = host(file(TWO))
    await h.manager.refresh?.()
    writeFileSync(h.target.file, file({ ...TWO, hand: { baseUrl: "https://hand.example" } }))
    await h.manager.refresh?.()
    expect(h.manager.endpoints().map((entry) => entry.id)).toEqual(["default", "company", "hand"])
    expect(h.events).toContain("rebuild")
  })

  test("[ADD-OK][ADD-INACTIVE][ADD-PRESERVE] add writes the endpoint, pins existing activation, new one stays inactive", async () => {
    const h = host(file(TWO))
    const result = await h.manager.add({ endpointId: "lab", baseUrl: "http://litellm.example:4000" })
    expect(result).toEqual({ ok: true, migrated: false })
    expect(h.activation).toEqual({ mode: "selected", endpointIds: ["default", "company"] })
    expect(h.active()).toEqual(["default", "company"])
    expect(h.options.endpoints?.lab?.baseUrl).toBe("http://litellm.example:4000")
    expect(h.options.endpoints?.company?.protocolOverrides).toEqual({ m: "messages" })
    expect(h.text()).toContain("// user comment")
    expect(h.options.pollInterval).toBe(90)
  })

  test("[ADD-ROLLBACK] a failed Add (write failure) rolls activation back to 'all' and leaves the config untouched", async () => {
    const h = host(file(TWO), { write: { rename: () => { throw new Error("disk full") } } })
    await h.manager.refresh?.()
    const result = await h.manager.add({ endpointId: "lab", baseUrl: "https://lab.example" })
    expect(result.ok).toBe(false)
    expect(h.activation).toEqual({ mode: "all" }) // previous activation restored, not left materialised
    expect(h.events.at(-1)).toBe('activation:{"mode":"all"}') // runtime reconciled back through setActivation
    expect(JSON.parse(h.text().replace(/^\s*\/\/.*$/gmu, "")).plugins[0].options.endpoints).toEqual(TWO)
    expect(h.active()).toEqual(["default", "company"])
  })

  test("[ADD-ROLLBACK] a failed Add (concurrent external edit / conflict) rolls activation back to 'all'", async () => {
    const h = host(file(TWO), {
      write: {
        beforeCommit: () => writeFileSync(h.target.file, file({ ...TWO, hand: { baseUrl: "https://hand.example" } })),
      },
    })
    await h.manager.refresh?.()
    const result = await h.manager.add({ endpointId: "lab", baseUrl: "https://lab.example" })
    expect(result.ok).toBe(false)
    expect(result.code).toBe("conflict")
    expect(h.activation).toEqual({ mode: "all" })
    expect(h.events.at(-1)).toBe('activation:{"mode":"all"}')
    // the external edit wins; our endpoint was not written
    expect(Object.keys(JSON.parse(h.text().replace(/^\s*\/\/.*$/gmu, "")).plugins[0].options.endpoints)).toEqual(["default", "company", "hand"])
  })

  test("[ADD-ROLLBACK] a rollback failure is reported together with the primary failure", async () => {
    const h = host(file(TWO))
    await h.manager.refresh?.()
    // the pin call succeeds; only the rollback call fails
    let calls = 0
    const failingHost = createEndpointManagement({
      env: {},
      target: h.target,
      options: () => parseOptions(readPluginOptions(h.target, PKG), { warn() {} }),
      ids: () => ["default", "company"],
      activation: () => ({ mode: "all" }),
      async setActivation() {
        calls += 1
        if (calls === 2) throw new Error("activation store unavailable")
      },
      async rebuild() {},
      async legacyBaseUrl() { return undefined },
      async removeStorage() {},
      async sourceTarget() { return PKG },
      write: { rename: () => { throw new Error("disk full") } },
    })
    const result = await failingHost.add({ endpointId: "lab", baseUrl: "https://lab.example" })
    expect(result.ok).toBe(false)
    expect(result.message).toContain("disk full") // primary failure first
    expect(result.message).toContain("activation 回滚失败") // rollback failure kept, not swallowed
    expect(result.message).toContain("activation store unavailable")
  })

  test("[ADD-DUP][ADD-BAD-ID][ADD-BAD-URL] invalid adds are rejected with a code and do not touch the file", async () => {
    const h = host(file(TWO))
    const before = h.text()
    expect((await h.manager.add({ endpointId: "company", baseUrl: "https://x.example" })).code).toBe("duplicate")
    expect((await h.manager.add({ endpointId: "Bad Id", baseUrl: "https://x.example" })).code).toBe("invalid-id")
    expect((await h.manager.add({ endpointId: "ok", baseUrl: "ftp://x" })).code).toBe("invalid-url")
    expect(h.text()).toBe(before)
  })

  test("[ADD-LEGACY] legacy with a connected address: needs confirmation, then migrates; legacy snapshot key is cleared", async () => {
    const h = host(file(undefined, ', "protocolOverrides": { "m": "chat" }'), { legacyUrl: "https://old.example" })
    const first = await h.manager.add({ endpointId: "lab", baseUrl: "https://lab.example" })
    expect(first.code).toBe("needs-migration")
    expect(h.options.endpoints).toBeUndefined()
    const second = await h.manager.add({ endpointId: "lab", baseUrl: "https://lab.example", confirmMigration: true })
    expect(second).toEqual({ ok: true, migrated: true })
    expect(h.options.endpoints).toEqual({
      default: { baseUrl: "https://old.example", protocolOverrides: { m: "chat" } },
      lab: { baseUrl: "https://lab.example", protocolOverrides: {} },
    })
    expect(h.removed).toContain("litellm.discovery.snapshot.v1")
    expect(h.activation).toEqual({ mode: "selected", endpointIds: ["default"] })
  })

  test("[EDIT-URL][EDIT-PRESERVE][EDIT-ISOLATED] edit changes only that Base URL", async () => {
    const h = host(file(TWO))
    expect((await h.manager.edit({ endpointId: "company", baseUrl: "https://new.example" })).ok).toBe(true)
    expect(h.options.endpoints?.company).toEqual({ baseUrl: "https://new.example", protocolOverrides: { m: "messages" } })
    expect(h.options.endpoints?.default?.baseUrl).toBe("https://a.example")
    expect((await h.manager.edit({ endpointId: "ghost", baseUrl: "https://x.example" })).code).toBe("not-found")
  })

  test("[EDIT-ATOMIC][CFG-PARSE-FAIL] unparseable config → read-only with explanation, file untouched", async () => {
    const h = host(file(TWO))
    writeFileSync(h.target.file, '{ "plugins": [ { "package": "' + PKG + '", "options": { ')
    const before = h.text()
    const result = await h.manager.edit({ endpointId: "company", baseUrl: "https://new.example" })
    expect(result.ok).toBe(false)
    expect(h.text()).toBe(before)
    expect(h.manager.writable().writable).toBe(false)
  })

  test("[CFG-SHADOWED] shadowed options (inline/project config differs from the file) → read-only", async () => {
    const h = host(file(TWO), { inlineOptions: { endpoints: { other: { baseUrl: "https://inline.example" } } } })
    const result = await h.manager.add({ endpointId: "lab", baseUrl: "https://lab.example" })
    expect(result.code).toBe("readonly")
    expect(h.manager.writable().problem).toContain("只读")
    expect(h.text()).toBe(file(TWO))
  })

  test("[DEL-CLEANUP][DEL-ISOLATED] prepareRemove stops + clears snapshot but keeps the definition; remove deletes it and its activation", async () => {
    const h = host(file(TWO))
    expect((await h.manager.prepareRemove({ endpointId: "company" })).ok).toBe(true)
    expect(h.options.endpoints?.company).toBeDefined() // definition kept until credentials are gone
    expect(h.removed).toContain("litellm.discovery.snapshot.v1.company")
    expect(h.active()).toEqual(["default"])
    expect((await h.manager.remove({ endpointId: "company" })).ok).toBe(true)
    expect(Object.keys(h.options.endpoints ?? {})).toEqual(["default"])
    expect(h.activation).toEqual({ mode: "selected", endpointIds: ["default"] })
    expect(h.text()).toContain("// user comment")
  })

  test("[LEGACY-MIGRATE] migrate moves the connected address into options.endpoints.default and keeps every identity and option", async () => {
    const h = host(file(undefined, ', "protocolOverrides": { "m": "chat" }, "futureOption": { "keep": 1 }'), { legacyUrl: "https://old.example" })
    await h.manager.refresh?.()
    const result = await h.manager.migrate()
    expect(result).toEqual({ ok: true, migrated: true })
    expect(h.options.endpoints).toEqual({
      default: { baseUrl: "https://old.example", protocolOverrides: { m: "chat" } },
    })
    // after migration the default endpoint is a normal managed endpoint: edit and delete work
    expect((await h.manager.edit({ endpointId: "default", baseUrl: "https://x.example" })).ok).toBe(true)
    expect(h.options.endpoints?.default?.baseUrl).toBe("https://x.example")
    expect((await h.manager.prepareRemove({ endpointId: "default" })).ok).toBe(true)
    expect((await h.manager.remove({ endpointId: "default" })).ok).toBe(true)
    expect(h.options.endpoints).toEqual({})
    expect(h.removed).toContain("litellm.discovery.snapshot.v1")
    // migrate is idempotent once explicit
    expect(await h.manager.migrate()).toEqual({ ok: true, migrated: false })
  })

  test("[LEGACY-MIGRATE][ADD-ROLLBACK] a failed migration leaves the config untouched (no partial state)", async () => {
    const h = host(file(undefined, ', "protocolOverrides": { "m": "chat" }'), {
      legacyUrl: "https://old.example",
      write: { rename: () => { throw new Error("disk full") } },
    })
    await h.manager.refresh?.()
    const result = await h.manager.migrate()
    expect(result.ok).toBe(false)
    expect(JSON.parse(h.text().replace(/^\s*\/\/.*$/gmu, "")).plugins[0].options.endpoints).toBeUndefined()
    expect(h.events).not.toContain("rebuild")
  })

  test("legacy default is refused (with a pointer to migration) if manage calls arrive before migrating", async () => {
    const h = host(file(), { legacyUrl: "https://old.example" })
    expect((await h.manager.prepareRemove({ endpointId: "default" })).code).toBe("legacy-default")
    expect((await h.manager.edit({ endpointId: "default", baseUrl: "https://x.example" })).code).toBe("legacy-default")
  })

  test("[DEL-NO-GHOST] deleted id re-added later is inactive and starts from no persisted snapshot", async () => {
    const h = host(file(TWO))
    await h.manager.prepareRemove({ endpointId: "company" })
    await h.manager.remove({ endpointId: "company" })
    await h.manager.add({ endpointId: "company", baseUrl: "https://b2.example" })
    expect(h.active()).toEqual(["default"])
    expect(h.options.endpoints?.company).toEqual({ baseUrl: "https://b2.example", protocolOverrides: {} })
  })
})
