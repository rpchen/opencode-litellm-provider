import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ConfigFileError, configCandidates, entryMatches, locateConfig, mutateEndpoints, readPluginOptions } from "../src/host/config-file.js"

const PKG = "github:rpchen/opencode-litellm-provider#v0.4.3"

function setup(content: string) {
  const dir = mkdtempSync(join(tmpdir(), "oc-cfg-"))
  const file = join(dir, "opencode.jsonc")
  writeFileSync(file, content)
  return { dir, file, text: () => readFileSync(file, "utf8") }
}

const JSONC = `{
  // my own settings — must survive
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude", /* inline */
  "plugins": [
    "other-plugin",
    {
      "package": "${PKG}",
      // plugin options
      "options": {
        "pollInterval": 120,
        "futureOption": { "keep": [1, 2] },
        "endpoints": {
          "default": { "baseUrl": "https://a.example", "protocolOverrides": { "m1": "chat" } },
          // the company one
          "company": { "baseUrl": "https://b.example", "protocolOverrides": { "m2": "messages" }, "custom": true }
        }
      }
    }
  ],
  "trailing": true,
}
`

async function code(run: () => unknown): Promise<string | undefined> {
  try { await run() } catch (error) { return error instanceof ConfigFileError ? error.code : `other:${String(error)}` }
  return undefined
}

describe("config-file (JSONC, comment-preserving)", () => {
  test("locate: OPENCODE_CONFIG first, then global XDG; matches the plugin entry by source/name", () => {
    const t = setup(JSONC)
    expect(configCandidates({ OPENCODE_CONFIG: t.file, XDG_CONFIG_HOME: "/x" })[0]).toBe(t.file)
    expect(locateConfig({ OPENCODE_CONFIG: t.file }, PKG)).toEqual({ file: t.file })
    expect(locateConfig({ OPENCODE_CONFIG: join(t.dir, "missing.jsonc"), XDG_CONFIG_HOME: join(t.dir, "nothing") })).toBeUndefined()
    expect(entryMatches("github:rpchen/opencode-litellm-provider", PKG)).toBe(true)
    expect(entryMatches("file:///C:/dev/opencode-litellm-provider/dist/index.js")).toBe(true)
    expect(entryMatches("some-other-plugin", PKG)).toBe(false)
  })

  test("[LIST-EXTERNAL] readPluginOptions reflects the file as it is now", () => {
    const t = setup(JSONC)
    expect((readPluginOptions({ file: t.file }, PKG).endpoints as Record<string, unknown>).company).toBeDefined()
  })

  test("[ADD-OK][ADD-PRESERVE][CFG-NON-DESTRUCTIVE][CFG-COMMENTS] add keeps comments, unknown options, other endpoints and formatting", () => {
    const t = setup(JSONC)
    mutateEndpoints({ file: t.file }, { kind: "add", id: "lab", baseUrl: "http://litellm.example:4000" }, { sourceTarget: PKG })
    const out = t.text()
    for (const keep of ["// my own settings — must survive", "/* inline */", "// plugin options", "// the company one", '"trailing": true,', '"futureOption": { "keep": [1, 2] }'])
      expect(out).toContain(keep)
    const options = readPluginOptions({ file: t.file }, PKG) as { endpoints: Record<string, { baseUrl: string }>; pollInterval: number }
    expect(Object.keys(options.endpoints)).toEqual(["default", "company", "lab"])
    expect(options.endpoints.lab?.baseUrl).toBe("http://litellm.example:4000")
    expect(options.pollInterval).toBe(120)
  })

  test("[EDIT-URL][EDIT-PRESERVE][EDIT-ISOLATED] edit changes only baseUrl; protocolOverrides/unknown fields/comments/other endpoints intact", () => {
    const t = setup(JSONC)
    mutateEndpoints({ file: t.file }, { kind: "edit", id: "company", baseUrl: "https://new.example" }, { sourceTarget: PKG })
    const options = readPluginOptions({ file: t.file }, PKG) as { endpoints: Record<string, any> }
    expect(options.endpoints.company).toEqual({ baseUrl: "https://new.example", protocolOverrides: { m2: "messages" }, custom: true })
    expect(options.endpoints.default).toEqual({ baseUrl: "https://a.example", protocolOverrides: { m1: "chat" } })
    expect(t.text()).toContain("// the company one")
    // textual diff is limited to the single URL literal
    expect(t.text().replace("https://new.example", "https://b.example")).toBe(JSONC)
  })

  test("[EDIT-ID-READONLY] edit of a missing id is rejected", () => {
    const t = setup(JSONC)
    expect(code(() => mutateEndpoints({ file: t.file }, { kind: "edit", id: "ghost", baseUrl: "https://x.example" }, { sourceTarget: PKG }))).resolves.toBe("not-found")
  })

  test("[DEL-ISOLATED] delete removes only that endpoint (and keeps an explicit endpoints object)", async () => {
    const t = setup(JSONC)
    mutateEndpoints({ file: t.file }, { kind: "delete", id: "company" }, { sourceTarget: PKG })
    let options = readPluginOptions({ file: t.file }, PKG) as { endpoints: Record<string, unknown> }
    expect(Object.keys(options.endpoints)).toEqual(["default"])
    mutateEndpoints({ file: t.file }, { kind: "delete", id: "default" }, { sourceTarget: PKG })
    options = readPluginOptions({ file: t.file }, PKG) as { endpoints: Record<string, unknown> }
    expect(options.endpoints).toEqual({})
    expect(t.text()).toContain("// my own settings — must survive")
  })

  test("[ADD-DUP] duplicate id rejected without writing", async () => {
    const t = setup(JSONC)
    expect(await code(() => mutateEndpoints({ file: t.file }, { kind: "add", id: "company", baseUrl: "https://c.example" }, { sourceTarget: PKG }))).toBe("duplicate")
    expect(t.text()).toBe(JSONC)
  })

  test.each(["Company", "-x", "a b", ""])("[ADD-BAD-ID] rejects %p", async (id) => {
    const t = setup(JSONC)
    expect(await code(() => mutateEndpoints({ file: t.file }, { kind: "add", id, baseUrl: "https://c.example" }, { sourceTarget: PKG }))).toBe("invalid-id")
    expect(t.text()).toBe(JSONC)
  })

  test.each(["", "   ", "litellm.example:4000", "ftp://x.example", "http://u:p@x.example"])("[ADD-BAD-URL] rejects %p", async (baseUrl) => {
    const t = setup(JSONC)
    expect(await code(() => mutateEndpoints({ file: t.file }, { kind: "add", id: "ok", baseUrl }, { sourceTarget: PKG }))).toBe("invalid-url")
    expect(t.text()).toBe(JSONC)
  })

  test("[CFG-PARSE-FAIL] syntactically broken config is refused and untouched", async () => {
    const broken = '{ "plugins": [ { "package": "' + PKG + '", "options": { ' // truncated
    const t = setup(broken)
    expect(await code(() => mutateEndpoints({ file: t.file }, { kind: "add", id: "a", baseUrl: "https://a.example" }, { sourceTarget: PKG }))).toBe("parse")
    expect(t.text()).toBe(broken)
  })

  test("no plugin entry in the file → refused", async () => {
    const t = setup('{ "plugins": ["other"] }')
    expect(await code(() => mutateEndpoints({ file: t.file }, { kind: "add", id: "a", baseUrl: "https://a.example" }, { sourceTarget: PKG }))).toBe("no-entry")
  })

  test("[EDIT-ATOMIC] interrupted replace leaves the original and no temp file", () => {
    const t = setup(JSONC)
    expect(() => mutateEndpoints({ file: t.file }, { kind: "add", id: "lab", baseUrl: "https://lab.example" }, { sourceTarget: PKG, rename: () => { throw new Error("disk full") } })).toThrow("disk full")
    expect(t.text()).toBe(JSONC)
    expect(readdirSync(t.dir)).toEqual(["opencode.jsonc"])
  })

  test("[CFG-CONFLICT] an external edit between read and replace aborts the write", async () => {
    const t = setup(JSONC)
    const external = JSONC.replace('"pollInterval": 120', '"pollInterval": 999')
    expect(await code(() => mutateEndpoints({ file: t.file }, { kind: "add", id: "lab", baseUrl: "https://lab.example" }, {
      sourceTarget: PKG,
      beforeCommit: () => writeFileSync(t.file, external),
    }))).toBe("conflict")
    expect(t.text()).toBe(external)
    expect(readdirSync(t.dir)).toEqual(["opencode.jsonc"])
  })

  test("[ADD-LEGACY] legacy (no endpoints): needs confirmation; then address + protocolOverrides move to endpoints.default", async () => {
    const legacy = `{
  // keep me
  "plugins": [{ "package": "${PKG}", "options": { "pollInterval": 60, "protocolOverrides": { "m": "chat" } } }]
}
`
    const t = setup(legacy)
    const add = { kind: "add" as const, id: "lab", baseUrl: "https://lab.example", migrateLegacy: { baseUrl: "https://old.example" } }
    expect(await code(() => mutateEndpoints({ file: t.file }, add, { sourceTarget: PKG }))).toBe("needs-migration")
    expect(t.text()).toBe(legacy)
    const result = mutateEndpoints({ file: t.file }, { ...add, confirmMigration: true }, { sourceTarget: PKG })
    expect(result.migratedLegacy).toBe(true)
    const options = readPluginOptions({ file: t.file }, PKG) as any
    expect(options.protocolOverrides).toBeUndefined()
    expect(options.pollInterval).toBe(60)
    expect(options.endpoints).toEqual({
      default: { baseUrl: "https://old.example", protocolOverrides: { m: "chat" } },
      lab: { baseUrl: "https://lab.example" },
    })
    expect(t.text()).toContain("// keep me")
  })

  test("[ADD-LEGACY] bare-string plugin entry becomes {package, options} without losing neighbours", () => {
    const t = setup(`{ "plugins": ["other", "${PKG}"] }`)
    mutateEndpoints({ file: t.file }, { kind: "add", id: "first", baseUrl: "https://f.example" }, { sourceTarget: PKG })
    const parsed = JSON.parse(t.text())
    expect(parsed.plugins[0]).toBe("other")
    expect(parsed.plugins[1]).toEqual({ package: PKG, options: { endpoints: { first: { baseUrl: "https://f.example" } } } })
  })

  test("legacy default cannot be edited/deleted here (its address lives in the credential)", async () => {
    const t = setup(`{ "plugins": [{ "package": "${PKG}", "options": { "pollInterval": 60 } }] }`)
    expect(await code(() => mutateEndpoints({ file: t.file }, { kind: "edit", id: "default", baseUrl: "https://x.example" }, { sourceTarget: PKG }))).toBe("legacy-default")
    expect(await code(() => mutateEndpoints({ file: t.file }, { kind: "delete", id: "default" }, { sourceTarget: PKG }))).toBe("legacy-default")
  })
})
