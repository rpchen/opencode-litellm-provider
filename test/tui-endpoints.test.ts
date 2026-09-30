import { describe, expect, test } from "bun:test"
import {
  createEndpointUi,
  credentialKind,
  integrationIdFor,
  removeKeys,
  saveKey,
  type CredentialClient,
  type EndpointRpcClient,
  type EndpointStateView,
} from "../src/tui-endpoints.js"

type Step = { select: string | undefined } | { prompt: string | undefined } | { confirm: boolean }

function world(initial: { endpoints: Array<{ id: string; baseUrl: string; active: boolean }>; legacy?: boolean; writable?: boolean; failCredentialRemove?: boolean; credentials?: Record<string, Array<{ type: string; id?: string; name?: string }>> }) {
  let endpoints = initial.endpoints.map((entry) => ({ ...entry, legacy: false }))
  if (initial.legacy) endpoints = [{ id: "default", baseUrl: "", active: true, legacy: true }]
  const creds: Record<string, Array<{ type: string; id?: string; name?: string }>> = structuredClone(initial.credentials ?? {})
  let nextId = 1
  const calls: string[] = []
  const toasts: Array<{ variant: string; message: string }> = []
  const log: Array<{ kind: string; title: string; options?: Array<{ title: string; value: string; description?: string }>; message?: string; value?: string; placeholder?: string }> = []
  let steps: Step[] = []

  const state = (): EndpointStateView => ({
    sequence: 1, sessionID: "s", mode: "selected",
    endpointIds: endpoints.map((e) => e.id),
    activeEndpointIds: endpoints.filter((e) => e.active).map((e) => e.id),
    endpoints: endpoints.map((e) => ({ ...e })),
    writable: initial.writable ?? true,
    ...(initial.writable === false ? { configProblem: "配置为只读" } : {}),
    legacyMigration: Boolean(initial.legacy),
  })
  const wrap = (ok: boolean, code?: string, message?: string, migrated = false) => ({ ok, ...(code ? { code } : {}), ...(message ? { message } : {}), migrated, state: state() })

  const rpc: EndpointRpcClient = {
    state: async () => state(),
    set: async (input) => {
      calls.push(`set:${input.action}:${input.endpointId}`)
      if (input.action === "toggle") endpoints = endpoints.map((e) => e.id === input.endpointId ? { ...e, active: !e.active } : e)
      if (input.action === "all") endpoints = endpoints.map((e) => ({ ...e, active: true }))
      if (input.action === "none") endpoints = endpoints.map((e) => ({ ...e, active: false }))
      return state()
    },
    add: async (input) => {
      calls.push(`add:${input.endpointId}:${input.baseUrl}:${input.confirmMigration ?? false}`)
      if (initial.legacy && !input.confirmMigration) return wrap(false, "needs-migration", "需要确认")
      if (endpoints.some((e) => e.id === input.endpointId)) return wrap(false, "duplicate", "已存在")
      endpoints = [...endpoints.map((e) => e.legacy ? { ...e, legacy: false, baseUrl: "https://migrated.example" } : e), { id: input.endpointId, baseUrl: input.baseUrl, active: false, legacy: false }]
      return wrap(true, undefined, undefined, Boolean(initial.legacy))
    },
    edit: async (input) => {
      calls.push(`edit:${input.endpointId}:${input.baseUrl}`)
      endpoints = endpoints.map((e) => e.id === input.endpointId ? { ...e, baseUrl: input.baseUrl } : e)
      return wrap(true)
    },
    prepareRemove: async (input) => { calls.push(`prepareRemove:${input.endpointId}`); endpoints = endpoints.map((e) => e.id === input.endpointId ? { ...e, active: false } : e); return wrap(true) },
    remove: async (input) => { calls.push(`remove:${input.endpointId}`); endpoints = endpoints.filter((e) => e.id !== input.endpointId); return wrap(true) },
  }

  const client: CredentialClient = {
    integration: {
      get: async (input) => ({ data: { connections: creds[input.integrationID] ?? [] } }),
      connect: { key: async (input) => {
        calls.push(`connect:${input.integrationID}`)
        creds[input.integrationID] = [...(creds[input.integrationID] ?? []), { type: "credential", id: `cred-${nextId++}` }]
      } },
    },
    credential: {
      remove: async (input) => {
        calls.push(`cred.remove:${input.credentialID}`)
        if (initial.failCredentialRemove) throw new Error("host credential store unavailable")
        for (const key of Object.keys(creds)) creds[key] = (creds[key] ?? []).filter((c) => c.id !== input.credentialID)
      },
      activate: async (input) => { calls.push(`cred.activate:${input.credentialID}`) },
    },
  }

  const next = <T,>(kind: string, title: string, extra: Record<string, unknown> = {}): T | undefined => {
    log.push({ kind, title, ...extra } as never)
    const step = steps.shift()
    if (!step) return (kind === "confirm" ? false : undefined) as T
    if (!(kind in step)) throw new Error(`script expected ${Object.keys(step)[0]} but host asked ${kind} "${title}"`)
    return (step as never as Record<string, T>)[kind]
  }
  const dialog = {
    select: async (options: { title: string; options: ReadonlyArray<{ title: string; value: string; description?: string }> }) => {
      const wanted = next<string>("select", options.title, { options: options.options })
      if (wanted === undefined) return undefined
      const hit = options.options.find((o) => o.title === wanted || o.value === wanted)
      if (!hit) throw new Error(`no option ${wanted} in ${JSON.stringify(options.options.map((o) => o.title))}`)
      return hit.value
    },
    prompt: async (options: { title: string; placeholder?: string; value?: string }) => next<string>("prompt", options.title, { placeholder: options.placeholder, value: options.value }),
    confirm: async (options: { title: string; message: string }) => next<boolean>("confirm", options.title, { message: options.message }),
  }
  const toast = { show: (input: { variant: "info" | "success" | "warning" | "error"; message: string }) => { toasts.push(input) } }
  const ui = createEndpointUi({ dialog: dialog as never, toast, rpc, client, isDisposed: () => false })
  return {
    calls, toasts, log, creds,
    run: async (script: Step[]) => { steps = [...script]; await ui.run(state()); expect(steps).toEqual([]) },
    endpoints: () => endpoints,
  }
}

const TWO = [{ id: "default", baseUrl: "https://a.example", active: true }, { id: "company", baseUrl: "https://b.example", active: false }]

describe("TUI endpoint management (host-native dialogs)", () => {
  test("[LIST-EMPTY] nothing configured → Add is offered as a real select option", async () => {
    const w = world({ endpoints: [] })
    await w.run([{ select: undefined }])
    expect(w.log[0]!.options!.map((o) => o.title)).toEqual(["＋ 新增 endpoint"])
  })

  test("[LIST-MULTI][HOST-UI] each line carries active + credential state; every interaction is a host dialog", async () => {
    const w = world({ endpoints: TWO, credentials: { "litellm-company": [{ type: "credential", id: "c1" }] } })
    await w.run([{ select: undefined }])
    const options = w.log[0]!.options!
    expect(options.find((o) => o.value === "endpoint:default")).toMatchObject({ title: "✓ default", description: "已启用 · 未连接" })
    expect(options.find((o) => o.value === "endpoint:company")).toMatchObject({ title: "○ company", description: "未启用 · 已连接" })
    expect(w.log.every((entry) => ["select", "prompt", "confirm"].includes(entry.kind))).toBe(true)
  })

  test("[ADD-OK][ADD-INACTIVE] Add asks ID then Base URL only, result is inactive + not connected", async () => {
    const w = world({ endpoints: TWO })
    await w.run([{ select: "add" }, { prompt: "lab" }, { prompt: "http://litellm.example:4000" }, { select: undefined }])
    expect(w.log.filter((l) => l.kind === "prompt").map((l) => l.title)).toEqual(["新增 endpoint：Endpoint ID", "新增 endpoint lab：Base URL"])
    expect(w.calls).toContain("add:lab:http://litellm.example:4000:false")
    expect(w.toasts.at(-1)!.message).toContain("未启用、未连接")
    expect(w.endpoints().find((e) => e.id === "lab")).toMatchObject({ active: false })
    expect(w.log.at(-1)!.options!.find((o) => o.value === "endpoint:lab")!.description).toBe("未启用 · 未连接")
  })

  test("[ADD-DUP][ADD-BAD-ID][ADD-BAD-URL] invalid input re-prompts locally and never reaches the server", async () => {
    const w = world({ endpoints: TWO })
    await w.run([
      { select: "add" },
      { prompt: "company" }, { prompt: "Bad Id" }, { prompt: undefined },
      { select: "add" },
      { prompt: "lab" }, { prompt: "ftp://x" }, { prompt: "http://u:p@x.example" }, { prompt: undefined },
      { select: undefined },
    ])
    expect(w.calls.filter((c) => c.startsWith("add:"))).toEqual([])
    expect(w.log.filter((l) => l.kind === "prompt" && l.title.includes("已存在")).length).toBe(1)
    expect(w.log.filter((l) => l.kind === "prompt" && l.title.includes("输入无效")).length).toBe(3)
  })

  test("[ADD-LEGACY] legacy: migration confirmation is asked; declining sends nothing, accepting sends confirmMigration", async () => {
    const w = world({ endpoints: [], legacy: true })
    await w.run([{ select: "add" }, { prompt: "lab" }, { prompt: "https://lab.example" }, { confirm: false }, { select: undefined }])
    expect(w.calls.filter((c) => c.startsWith("add:"))).toEqual([])
    await w.run([{ select: "add" }, { prompt: "lab" }, { prompt: "https://lab.example" }, { confirm: true }, { select: undefined }])
    expect(w.calls).toContain("add:lab:https://lab.example:true")
  })

  test("Add is refused with the reason when the config is read-only", async () => {
    const w = world({ endpoints: TWO, writable: false })
    await w.run([{ select: "add" }, { select: undefined }])
    expect(w.toasts.at(-1)).toMatchObject({ variant: "error", message: "配置为只读" })
    expect(w.calls.filter((c) => c.startsWith("add:"))).toEqual([])
  })

  test("[EDIT-URL][EDIT-ID-READONLY] Edit prompts only for the Base URL (prefilled), ID is never asked", async () => {
    const w = world({ endpoints: TWO })
    await w.run([{ select: "endpoint:company" }, { select: "edit" }, { prompt: "https://new.example" }, { select: "back" }, { select: undefined }])
    const prompts = w.log.filter((l) => l.kind === "prompt")
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toMatchObject({ value: "https://b.example", placeholder: "https://b.example" })
    expect(prompts[0]!.title).toContain("ID 不可修改")
    expect(w.calls).toContain("edit:company:https://new.example")
  })

  test("[CRED-CONNECT][CRED-ACTIVATION-INDEPENDENT][CRED-NO-ECHO] connect on an inactive endpoint: stored through the host API, activation unchanged, key never shown", async () => {
    const w = world({ endpoints: TWO })
    await w.run([{ select: "endpoint:company" }, { select: "connect" }, { prompt: "sk-secret-123" }, { select: "back" }, { select: undefined }])
    expect(w.calls).toEqual(expect.arrayContaining(["connect:litellm-company", "cred.activate:cred-1"]))
    expect(w.calls.some((c) => c.startsWith("set:"))).toBe(false)
    expect(JSON.stringify({ log: w.log, toasts: w.toasts, calls: w.calls })).not.toContain("sk-secret-123")
    expect(w.log.at(-1)!.options!.find((o) => o.value === "endpoint:company")).toMatchObject({ description: "未启用 · 已连接" })
  })

  test("[CRED-REPLACE] replace overwrites: new key added and activated, the old credential removed", async () => {
    const w = world({ endpoints: TWO, credentials: { "litellm-company": [{ type: "credential", id: "old-1" }] } })
    await w.run([{ select: "endpoint:company" }, { select: "connect" }, { prompt: "sk-new" }, { select: "back" }, { select: undefined }])
    expect(w.creds["litellm-company"]!.map((c) => c.id)).toEqual(["cred-1"])
    expect(w.calls).toEqual(expect.arrayContaining(["connect:litellm-company", "cred.activate:cred-1", "cred.remove:old-1"]))
    expect(w.log.some((l) => l.kind === "select" && l.title.includes("已连接"))).toBe(true)
  })

  test("[CRED-DISCONNECT][CRED-ACTIVATION-INDEPENDENT] disconnect removes only this endpoint's credentials after confirmation; declining keeps them", async () => {
    const w = world({ endpoints: TWO, credentials: { "litellm-company": [{ type: "credential", id: "c1" }], litellm: [{ type: "credential", id: "d1" }, { type: "env", name: "LITELLM_API_KEY" }] } })
    await w.run([{ select: "endpoint:company" }, { select: "disconnect" }, { confirm: false }, { select: "disconnect" }, { confirm: true }, { select: "back" }, { select: undefined }])
    expect(w.calls.filter((c) => c.startsWith("cred.remove"))).toEqual(["cred.remove:c1"])
    expect(w.creds.litellm!.map((c) => c.id)).toEqual(["d1", undefined])
    expect(w.calls.some((c) => c.startsWith("set:") || c.startsWith("remove:"))).toBe(false)
  })

  test("[CRED-INVALID-KEY] bad key is rejected locally; nothing is stored", async () => {
    const w = world({ endpoints: TWO })
    await w.run([{ select: "endpoint:company" }, { select: "connect" }, { prompt: "bad key" }, { select: "back" }, { select: undefined }])
    expect(w.calls.some((c) => c.startsWith("connect:"))).toBe(false)
    expect(w.toasts.at(-1)!.variant).toBe("warning")
  })

  test("[ACT-TOGGLE][ACT-ZERO][ACT-CRED-INDEPENDENT] activate/deactivate through the detail screen; bulk none → zero active", async () => {
    const w = world({ endpoints: TWO, credentials: { litellm: [{ type: "credential", id: "d1" }] } })
    await w.run([{ select: "endpoint:company" }, { select: "toggle" }, { select: "back" }, { select: "none" }, { select: undefined }])
    expect(w.calls).toEqual(expect.arrayContaining(["set:toggle:company", "set:none:"]))
    expect(w.endpoints().every((e) => !e.active)).toBe(true)
    expect(w.creds.litellm).toHaveLength(1)
  })

  test("[DEL-CONFIRM][DEL-CANCEL] confirmation lists what is removed; cancelling changes nothing", async () => {
    const w = world({ endpoints: TWO, credentials: { "litellm-company": [{ type: "credential", id: "c1" }] } })
    await w.run([{ select: "endpoint:company" }, { select: "delete" }, { confirm: false }, { select: "back" }, { select: undefined }])
    const confirm = w.log.find((l) => l.kind === "confirm")!
    for (const word of ["配置", "启用状态", "API Key", "缓存"]) expect(confirm.message).toContain(word)
    expect(w.calls.some((c) => c.startsWith("prepareRemove") || c.startsWith("remove:") || c.startsWith("cred.remove"))).toBe(false)
    expect(w.creds["litellm-company"]).toHaveLength(1)
  })

  test("[DEL-CLEANUP][DEL-ISOLATED] delete order: prepareRemove → credentials → remove; other endpoints keep everything", async () => {
    const w = world({ endpoints: TWO, credentials: { "litellm-company": [{ type: "credential", id: "c1" }], litellm: [{ type: "credential", id: "d1" }] } })
    await w.run([{ select: "endpoint:company" }, { select: "delete" }, { confirm: true }, { select: undefined }])
    const ordered = w.calls.filter((c) => /^(prepareRemove|cred\.remove|remove):/.test(c))
    expect(ordered).toEqual(["prepareRemove:company", "cred.remove:c1", "remove:company"])
    expect(w.endpoints().map((e) => e.id)).toEqual(["default"])
    expect(w.creds.litellm).toHaveLength(1)
  })

  test("[DEL-PARTIAL-FAILURE] a credential cleanup failure keeps the definition so Delete can be retried", async () => {
    const w = world({ endpoints: TWO, failCredentialRemove: true, credentials: { "litellm-company": [{ type: "credential", id: "c1" }] } })
    await w.run([{ select: "endpoint:company" }, { select: "delete" }, { confirm: true }, { select: "back" }, { select: undefined }])
    expect(w.calls).toContain("prepareRemove:company")
    expect(w.calls.some((c) => c.startsWith("remove:"))).toBe(false) // definition never removed
    expect(w.endpoints().map((e) => e.id)).toContain("company")
    expect(w.toasts.some((x) => x.variant === "error" && x.message.includes("可重试"))).toBe(true)
  })

  test("legacy default offers no Edit/Delete in its detail screen (its address lives in the credential)", async () => {
    const w = world({ endpoints: [], legacy: true })
    await w.run([{ select: "endpoint:default" }, { select: "back" }, { select: undefined }])
    const detail = w.log.find((l) => l.kind === "select" && l.title.startsWith("default"))!
    expect(detail.options!.map((o) => o.value)).toEqual(["toggle", "connect", "back"])
  })
})

describe("credential helpers", () => {
  test("[CRED-CONNECT-CONSISTENT] the management UI reads and writes the same host credential store /connect uses", async () => {
    // One shared fake host store: a key saved by the host's own connect call is seen by the UI, and vice versa.
    const store: Record<string, Array<{ type: string; id?: string }>> = {}
    let n = 0
    const client: CredentialClient = {
      integration: {
        get: async (i) => ({ connections: store[i.integrationID] ?? [] }),
        connect: { key: async (i) => { (store[i.integrationID] ??= []).push({ type: "credential", id: `c${++n}` }) } },
      },
      credential: { remove: async (i) => { for (const k of Object.keys(store)) store[k] = store[k]!.filter((c) => c.id !== i.credentialID) }, activate: async () => undefined },
    }
    // saved by the host's /connect (same API the native flow uses) → UI sees Connected
    await client.integration.connect.key({ integrationID: "litellm-company", key: "sk-host" })
    expect(await credentialKind(client, "company")).toBe("stored")
    // saved by the management UI → the host's own listing sees it (no second store)
    await saveKey(client, "lab", "sk-ui")
    expect((await client.integration.get({ integrationID: "litellm-lab" }) as { connections: unknown[] }).connections).toHaveLength(1)
    // UI disconnect is visible to the host listing as well
    await removeKeys(client, "company")
    expect(await credentialKind(client, "company")).toBe("none")
  })

  test("integration ids follow the plugin's identity mapping", () => {
    expect(integrationIdFor("default")).toBe("litellm")
    expect(integrationIdFor("company")).toBe("litellm-company")
  })

  test("env connections are reported but never removed", async () => {
    const creds = { litellm: [{ type: "env", name: "LITELLM_API_KEY" }] }
    const client: CredentialClient = {
      integration: { get: async (i) => ({ connections: (creds as any)[i.integrationID] ?? [] }), connect: { key: async () => undefined } },
      credential: { remove: async () => { throw new Error("must not remove env") }, activate: async () => undefined },
    }
    expect(await credentialKind(client, "default")).toBe("environment")
    await removeKeys(client, "default")
    expect(await credentialKind(client, "company")).toBe("none")
    void saveKey
  })
})
