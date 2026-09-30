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

function host(content: string, opts: { legacyUrl?: string; inlineOptions?: unknown } = {}) {
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

  test("[LIST-EMPTY] explicit empty endpoints lists nothing; legacy lists the single default", async () => {
    const empty = host(file({}))
    await empty.manager.refresh?.()
    expect(empty.manager.endpoints()).toEqual([])
    const legacy = host(file())
    expect(legacy.manager.endpoints()).toEqual([{ id: "default", baseUrl: "", active: true, legacy: true }])
    expect(legacy.manager.writable().legacyMigration).toBe(true)
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

  test("[EDIT-ENV-LEGACY] legacy default (address lives in the /connect credential) cannot be edited or removed here", async () => {
    const h = host(file())
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
