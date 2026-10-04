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

function world(initial: {
  endpoints: Array<{ id: string; baseUrl: string; active: boolean }>
  legacy?: boolean
  /** Legacy default's connected address (the credential stores it; the config does not). */
  legacyUrl?: string
  /** Legacy integration's key method carries a required url form field. */
  legacyKeyForm?: boolean
  writable?: boolean
  failCredentialRemove?: boolean
  failMigrate?: boolean
  /** Add commits the config but the runtime reload fails afterwards (saved-but-not-reloaded). */
  addSavedFailure?: boolean
  credentials?: Record<string, Array<{ type: string; id?: string; name?: string }>>
}) {
  let endpoints = initial.endpoints.map((entry) => ({ ...entry, legacy: false }))
  if (initial.legacy) endpoints = [{ id: "default", baseUrl: initial.legacyUrl ?? "", active: true, legacy: true }]
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
    endpoints: endpoints.map((e) => ({ ...e })).filter((e) => !e.legacy || e.baseUrl !== ""),
    writable: initial.writable ?? true,
    ...(initial.writable === false ? { configProblem: "配置为只读" } : {}),
    legacyMigration: Boolean(initial.legacy),
  })
  const wrap = (ok: boolean, code?: string, message?: string, migrated = false) => ({ ok, ...(code ? { code } : {}), ...(message ? { message } : {}), migrated, state: state() })
  const connectCalls: Array<{ integrationID: string; key: string; answer?: unknown }> = []

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
      if (initial.addSavedFailure) {
        return { ok: false, saved: true, code: "rebuild-failed", migrated: Boolean(initial.legacy), message: "endpoint 配置已保存，但运行时重新加载失败；新 endpoint 保持未启用，可稍后重试 reload", state: state() }
      }
      return wrap(true, undefined, undefined, Boolean(initial.legacy))
    },
    edit: async (input) => {
      calls.push(`edit:${input.endpointId}:${input.baseUrl}`)
      endpoints = endpoints.map((e) => e.id === input.endpointId ? { ...e, baseUrl: input.baseUrl } : e)
      return wrap(true)
    },
    prepareRemove: async (input) => { calls.push(`prepareRemove:${input.endpointId}`); endpoints = endpoints.map((e) => e.id === input.endpointId ? { ...e, active: false } : e); return wrap(true) },
    remove: async (input) => { calls.push(`remove:${input.endpointId}`); endpoints = endpoints.filter((e) => e.id !== input.endpointId); return wrap(true) },
    migrate: async () => {
      calls.push("migrate")
      if (initial.failMigrate) return wrap(false, "error", "迁移失败")
      // legacy → explicit: same id, same credential, address now lives in the config
      endpoints = endpoints.map((e) => (e.legacy ? { id: "default", baseUrl: initial.legacyUrl ?? e.baseUrl, active: e.active, legacy: false } : e))
      return wrap(true, undefined, undefined, true)
    },
    trigger: async (input) => { calls.push(`trigger:${input.endpointId}`); return wrap(true) },
  }

  const client: CredentialClient = {
    integration: {
      get: async (input) => ({
        data: {
          connections: creds[input.integrationID] ?? [],
          methods: [{
            type: "key",
            ...(initial.legacyKeyForm ? { form: [{ key: "url", type: "string", required: true }] } : {}),
          }],
        },
      }),
      connect: { key: async (input) => {
        calls.push(`connect:${input.integrationID}`)
        connectCalls.push({ integrationID: input.integrationID, key: input.key, ...(input.answer ? { answer: input.answer } : {}) })
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
    calls, toasts, log, creds, connectCalls,
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
    expect(options.find((o) => o.value === "endpoint:default")).toMatchObject({ title: "✓ default", description: "已启用 · 未保存 API Key" })
    expect(options.find((o) => o.value === "endpoint:company")).toMatchObject({ title: "○ company", description: "未启用 · 已保存 API Key" })
    expect(w.log.every((entry) => ["select", "prompt", "confirm"].includes(entry.kind))).toBe(true)
  })

  test("[ADD-OK][ADD-INACTIVE] Add asks ID then Base URL only, result is inactive + not connected", async () => {
    const w = world({ endpoints: TWO })
    await w.run([{ select: "add" }, { prompt: "lab" }, { prompt: "http://litellm.example:4000" }, { select: undefined }])
    expect(w.log.filter((l) => l.kind === "prompt").map((l) => l.title)).toEqual(["新增 endpoint：Endpoint ID", "新增 endpoint lab：Base URL"])
    expect(w.calls).toContain("add:lab:http://litellm.example:4000:false")
    expect(w.toasts.at(-1)!.message).toContain("未启用、未连接")
    expect(w.endpoints().find((e) => e.id === "lab")).toMatchObject({ active: false })
    expect(w.log.at(-1)!.options!.find((o) => o.value === "endpoint:lab")!.description).toBe("未启用 · 未保存 API Key")
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

  test("[ADD-LEGACY] legacy with a connected address: migration confirmation is asked; declining sends nothing, accepting sends confirmMigration", async () => {
    const w = world({ endpoints: [], legacy: true, legacyUrl: "https://old.example" })
    await w.run([{ select: "add" }, { prompt: "lab" }, { prompt: "https://lab.example" }, { confirm: false }, { select: undefined }])
    expect(w.calls.filter((c) => c.startsWith("add:"))).toEqual([])
    await w.run([{ select: "add" }, { prompt: "lab" }, { prompt: "https://lab.example" }, { confirm: true }, { select: undefined }])
    expect(w.calls).toContain("add:lab:https://lab.example:true")
  })

  test("[ADD-LEGACY][LIST-LEGACY-GHOST] legacy without any connected address: nothing to migrate, Add proceeds without a confirmation", async () => {
    const w = world({ endpoints: [], legacy: true })
    await w.run([{ select: "add" }, { prompt: "first" }, { prompt: "https://first.example" }, { select: undefined }])
    expect(w.calls).toContain("add:first:https://first.example:false")
    expect(w.log.filter((l) => l.kind === "confirm")).toEqual([])
  })

  test("[ADD-ROLLBACK] a saved-but-reload-failed Add is reported as saved (warning), not as a plain failure", async () => {
    const w = world({ endpoints: TWO, addSavedFailure: true })
    await w.run([{ select: "add" }, { prompt: "lab" }, { prompt: "https://lab.example" }, { select: undefined }])
    const toast = w.toasts.at(-1)!
    expect(toast.variant).toBe("warning") // not an "Add failed" error: the config IS saved
    expect(toast.message).toContain("配置已保存")
    expect(toast.message).toContain("运行时重新加载失败")
    expect(w.endpoints().find((e) => e.id === "lab")).toMatchObject({ active: false }) // stays inactive
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
    expect(w.log.at(-1)!.options!.find((o) => o.value === "endpoint:company")).toMatchObject({ description: "未启用 · 已保存 API Key" })
  })

  test("[CRED-REPLACE] replace overwrites: new key added and activated, the old credential removed", async () => {
    const w = world({ endpoints: TWO, credentials: { "litellm-company": [{ type: "credential", id: "old-1" }] } })
    await w.run([{ select: "endpoint:company" }, { select: "connect" }, { prompt: "sk-new" }, { select: "back" }, { select: undefined }])
    expect(w.creds["litellm-company"]!.map((c) => c.id)).toEqual(["cred-1"])
    expect(w.calls).toEqual(expect.arrayContaining(["connect:litellm-company", "cred.activate:cred-1", "cred.remove:old-1"]))
    expect(w.log.some((l) => l.kind === "select" && l.title.includes("已保存 API Key"))).toBe(true)
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

  test("[LEGACY-MIGRATE] legacy detail offers the full management flow; Edit migrates first, then edits", async () => {
    const w = world({ endpoints: [], legacy: true, legacyUrl: "https://old.example" })
    await w.run([{ select: "endpoint:default" }, { select: "edit" }, { confirm: true }, { prompt: "https://new.example" }, { select: "back" }, { select: undefined }])
    const detail = w.log.find((l) => l.kind === "select" && l.title.startsWith("default"))!
    expect(detail.options!.map((o) => o.value)).toEqual(["toggle", "edit", "connect", "delete", "back"])
    expect(w.calls).toEqual(["migrate", "edit:default:https://new.example"])
    const confirm = w.log.find((l) => l.kind === "confirm")!
    expect(confirm.message).toContain("options.endpoints.default")
    expect(confirm.message).toContain("integration")
  })

  test("[DEL-CANCEL][DEL-CONFIRM][LEGACY-MIGRATE] cancelling the legacy Delete runs no migration, no cleanup and no credential removal", async () => {
    const w = world({ endpoints: [], legacy: true, legacyUrl: "https://old.example", credentials: { litellm: [{ type: "credential", id: "old-1" }] } })
    await w.run([{ select: "endpoint:default" }, { select: "delete" }, { confirm: false }, { select: "back" }, { select: undefined }])
    const confirm = w.log.find((l) => l.kind === "confirm")!
    expect(confirm.title).toContain(`删除 endpoint default`)
    expect(confirm.message).toContain("legacy") // the confirmation explains the internal migration up front
    expect(confirm.message).toContain("options.endpoints.default")
    expect(w.calls).toEqual([]) // no migrate / prepareRemove / cred.remove / remove at all
    expect(w.endpoints().map((e) => e.id)).toEqual(["default"]) // config is still the legacy form
    expect(w.endpoints()[0]!.active).toBe(true) // activation unchanged
    expect(w.creds.litellm).toHaveLength(1) // credential connection unchanged
  })

  test("[LEGACY-MIGRATE][DEL-CLEANUP][DEL-CONFIRM] legacy Delete confirms the whole action first, then migrates and deletes definition and credential", async () => {
    const w = world({ endpoints: [], legacy: true, legacyUrl: "https://old.example", credentials: { litellm: [{ type: "credential", id: "old-1" }] } })
    await w.run([{ select: "endpoint:default" }, { select: "delete" }, { confirm: true }, { select: undefined }])
    expect(w.calls).toEqual(["migrate", "prepareRemove:default", "cred.remove:old-1", "remove:default"])
    expect(w.endpoints()).toEqual([])
  })

  test("[LEGACY-MIGRATE] a failed migration keeps the flow cancelled and the endpoint untouched", async () => {
    const w = world({ endpoints: [], legacy: true, legacyUrl: "https://old.example", failMigrate: true })
    await w.run([{ select: "endpoint:default" }, { select: "edit" }, { confirm: true }, { select: "back" }, { select: undefined }])
    expect(w.calls).toEqual(["migrate"])
    expect(w.toasts.some((x) => x.variant === "error" && x.message.includes("迁移失败"))).toBe(true)
  })

  test("[LIST-LEGACY-GHOST] legacy default without a connected address is not listed; Add is offered", async () => {
    const w = world({ endpoints: [], legacy: true })
    await w.run([{ select: undefined }])
    expect(w.log[0]!.options!.map((o) => o.value)).toEqual(["add"])
  })
})

describe("credential form (legacy url answer)", () => {
  const formClient = (form: unknown, existing: unknown[] = []): { client: CredentialClient; calls: any[] } => {
    const calls: any[] = []
    const client: CredentialClient = {
      integration: {
        get: async () => ({ data: { connections: existing, methods: [{ type: "key", ...(form ? { form } : {}) }] } }),
        connect: { key: async (input) => { calls.push(input) } },
      },
      credential: { remove: async () => undefined, activate: async () => undefined },
    }
    return { client, calls }
  }

  test("[CRED-LEGACY-FORM] legacy key method with a required url form gets answer.url", async () => {
    const { client, calls } = formClient([{ key: "url", type: "string", required: true }])
    await saveKey(client, "default", "sk-form", "https://old.example")
    expect(calls).toEqual([{ integrationID: "litellm", key: "sk-form", answer: { url: "https://old.example" } }])
  })

  test("[CRED-LEGACY-FORM] without a url to answer the connect is refused, never sent in a broken form", async () => {
    const { client, calls } = formClient([{ key: "url", type: "string", required: true }])
    await expect(saveKey(client, "default", "sk-form")).rejects.toThrow("url")
    expect(calls).toEqual([])
  })

  test("[CRED-LEGACY-FORM] fixed-baseUrl key method (no form) gets no answer payload", async () => {
    const { client, calls } = formClient(undefined)
    await saveKey(client, "company", "sk-plain", "https://ignored.example")
    expect(calls).toEqual([{ integrationID: "litellm-company", key: "sk-plain" }])
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
