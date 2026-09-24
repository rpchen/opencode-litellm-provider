import { describe, expect, test } from "bun:test"
import { buildModelSpecs } from "../src/core/build.js"
import { createAuditReport } from "../src/host/audit.js"
import { applyProvider, createRegistrationView, type ProviderEditorLike, type ProviderSnapshot } from "../src/host/register.js"
import liteLLM from "./fixtures/litellm-model-info.json" with { type: "json" }
import catalog from "./fixtures/models-dev.json" with { type: "json" }

const options = { contextTierCap: true, protocolOverrides: {} }

test("固定发现样本导出与注册模型逐字段对应", () => {
  const specs = buildModelSpecs(liteLLM, catalog, options)
  const view = createRegistrationView(specs, "https://private.example/v1")
  expect(Object.isFrozen(view)).toBeTrue()
  expect(Object.isFrozen(view.models[0])).toBeTrue()
  expect(Object.isFrozen(view.models[0]?.variants)).toBeTrue()
  const registeredNames = view.models.map((item) => item.name)
  specs[0]!.name = "after-snapshot-change"
  expect(view.models.map((item) => item.name)).toEqual(registeredNames)
  const snapshot: ProviderSnapshot = {
    ready: true,
    connection: { type: "credential", id: "hidden-credential", label: "team", method: "key" },
    apiBaseURL: "https://private.example/v1",
    models: specs,
    registrationView: view,
    audit: { status: "ready", view, lastSuccessfulDiscoveryAt: "2026-09-24T00:00:00.000Z" },
  }
  let submitted: Parameters<ProviderEditorLike["add"]>[0] | undefined
  applyProvider({ add: (input) => { submitted = input } }, snapshot)
  expect(submitted?.models).toBe(view.models)
  const report = createAuditReport(snapshot.audit!, new Date("2026-09-24T01:00:00Z")) as {
    schemaVersion: number
    status: string
    models: Array<Record<string, any>>
  }
  expect(report.schemaVersion).toBe(1)
  expect(report.status).toBe("ready")
  expect(report.models.map((item) => item.id)).toEqual(submitted!.models.map((item) => String(item.id)))
  for (const [index, output] of report.models.entries()) {
    const model = submitted!.models[index]!
    expect(output).toMatchObject({
      id: model.id,
      modelID: model.modelID,
      providerID: model.providerID,
      name: model.name,
      package: model.package,
      protocol: view.protocols[String(model.id)],
      capabilities: model.capabilities,
      time: { released: model.time.released, unit: view.releaseUnits[String(model.id)] },
      cost: model.cost,
      status: model.status,
      enabled: model.enabled,
      limit: model.limit,
    })
    expect(output.variants).toEqual(model.variants)
  }
  const serialized = JSON.stringify(report)
  expect(serialized).not.toContain("private.example")
  expect(serialized).not.toContain("hidden-credential")
})

describe("发布日期单位及 allowlist", () => {
  test("字符串、数值、缺失及无效日期保留注册数值并分别标注", () => {
    const response = { data: ["date-text", "date-number", "date-missing", "date-invalid", "date-epoch"].map((model_name) => ({ model_name, model_info: {}, litellm_params: { model: model_name } })) }
    const models = {
      "date-text": { release_date: "2026-01-02", reasoning_options: [{ type: "effort", values: ["high"] }] },
      "date-number": { release_date: 1234567890 },
      "date-missing": {},
      "date-invalid": { release_date: "not-a-date" },
      "date-epoch": { release_date: "1970-01-01T00:00:00.000Z" },
    }
    const specs = buildModelSpecs(response, { vendor: { models } }, options)
    const view = createRegistrationView(specs, "https://private.example/v1")
    const output = createAuditReport({ status: "ready", view }) as { models: Array<{ id: string; time: { released: number; unit: string }; variants: Array<{ id: string; settings: object }> }> }
    const byID = Object.fromEntries(output.models.map((model) => [model.id, model]))
    expect(byID["date-text"]?.time).toEqual({ released: Date.parse("2026-01-02"), unit: "unix-ms" })
    expect(byID["date-number"]?.time).toEqual({ released: 1234567890, unit: "unknown" })
    expect(byID["date-missing"]?.time).toEqual({ released: 0, unit: "none" })
    expect(byID["date-invalid"]?.time).toEqual({ released: 0, unit: "none" })
    expect(byID["date-epoch"]?.time).toEqual({ released: 0, unit: "unix-ms" })
    expect(byID["date-text"]?.variants).toEqual([{ id: "high", settings: { reasoningEffort: "high" } }])
  })

  test("凭据、连接、上游原文和扩展设置不进入报告，允许字段不被改写", () => {
    const secret = "sk-fixture-not-real"
    const response = { data: [{ model_name: "internal-model", litellm_params: { model: "openai/internal-model", api_key: secret, api_base: "https://private.example" }, model_info: { api_key: secret, route: "private-route", base_model: "internal-model" } }] }
    const catalog = { internal: { models: { "internal-model": { reasoning_options: [{ type: "effort", values: ["internal-high"] }], hidden: secret } } } }
    const specs = buildModelSpecs(response, catalog, options)
    const view = createRegistrationView(specs, "https://private.example/v1")
    const model = view.models[0]!
    // 模拟宿主模型对象中的未来扩展字段：序列化必须仍只取显式允许的字段。
    const expanded = { ...model, settings: { authorization: secret }, extra: { prompt: "private-prompt" }, variants: [{ id: "internal-high", settings: { reasoningEffort: "internal-high", authorization: secret } }] }
    const auditView = { ...view, models: [expanded] } as unknown as typeof view
    const report = createAuditReport({ status: "ready", view: auditView })
    const serialized = JSON.stringify(report)
    expect(serialized).toContain("internal-model")
    expect(serialized).toContain("internal-high")
    for (const forbidden of [secret, "private.example", "private-route", "private-prompt", "api_base", "authorization"]) {
      expect(serialized).not.toContain(forbidden)
    }
    expect((report as { models: Array<{ variants: Array<{ settings: object }> }> }).models[0]?.variants[0]?.settings).toEqual({ reasoningEffort: "internal-high" })
  })
})
