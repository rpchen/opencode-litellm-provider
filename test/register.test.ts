import { describe, expect, test } from "bun:test"
import type { ModelSpec } from "../src/core/build.js"
import {
  applyIntegration,
  applyProvider,
  type IntegrationEditorLike,
  type ProviderEditorLike,
  type ProviderSnapshot,
} from "../src/host/register.js"

function model(id: string): ModelSpec {
  return {
    id,
    name: id,
    protocol: "responses",
    package: "@opencode/ai/providers/openai-compatible-responses",
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: [{ id: "high", settings: { reasoningEffort: "high" } }],
    released: 123,
    cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 },
    limit: { context: 128000, input: 128000, output: 32000 },
  }
}

function fakeIntegration() {
  const integration = { id: "litellm", name: "old" }
  const methods: unknown[] = []
  const editor = {
    update: (_id: string, update: (value: typeof integration) => void) => update(integration),
    method: { update: (input: unknown) => methods.push(input) },
  } as unknown as IntegrationEditorLike
  return { editor, integration, methods }
}

function fakeProvider() {
  let value: Parameters<ProviderEditorLike["add"]>[0] | undefined
  const editor = {
    add: (input: Parameters<ProviderEditorLike["add"]>[0]) => {
      value = structuredClone(input)
    },
  } as unknown as ProviderEditorLike
  return { editor, get value() { return value } }
}

function snapshot(models: ModelSpec[] = [model("gpt-5.5")]): ProviderSnapshot {
  return {
    ready: true,
    connection: { type: "credential", id: "credential-1", label: "team", method: "key" },
    apiBaseURL: "https://litellm.example/v1",
    models,
  }
}

describe("integration 注册", () => {
  test("注册 key 方式和必填 url 字段", () => {
    const fake = fakeIntegration()
    applyIntegration(fake.editor)
    expect(fake.integration.name).toBe("LiteLLM")
    expect(fake.methods).toEqual([
      {
        integrationID: "litellm",
        method: {
          type: "key",
          label: "API Key",
          form: [
            {
              key: "url",
              type: "string",
              format: "uri",
              required: true,
              title: "LiteLLM 地址",
              placeholder: "http://litellm.example:4000",
            },
          ],
        },
      },
    ])
  })
})

describe("provider 注册", () => {
  test("整体写入完整字段且不写入 Key", () => {
    const fake = fakeProvider()
    applyProvider(fake.editor, snapshot())
    expect(fake.value?.info).toMatchObject({
      id: "litellm",
      integrationID: "litellm",
      name: "LiteLLM",
      activation: "auto",
      settings: { baseURL: "https://litellm.example/v1" },
    })
    expect(fake.value?.sourceConnection).toEqual(snapshot().connection)
    expect(fake.value?.models[0]).toMatchObject({
      id: "gpt-5.5",
      modelID: "gpt-5.5",
      providerID: "litellm",
      name: "gpt-5.5",
      package: "@opencode/ai/providers/openai-compatible-responses",
      capabilities: { tools: true, input: ["text"], output: ["text"] },
      variants: [{ id: "high", settings: { reasoningEffort: "high" } }],
      time: { released: 123 },
      status: "active",
      enabled: true,
      limit: { context: 128000, input: 128000, output: 32000 },
    })
    expect(JSON.stringify(fake.value)).not.toContain("apiKey")
    expect(JSON.stringify(fake.value)).not.toContain("secret")
  })

  test("下一次 add 整体替换旧模型", () => {
    const fake = fakeProvider()
    applyProvider(fake.editor, snapshot([model("old"), model("kept")]))
    applyProvider(fake.editor, snapshot([model("kept"), model("new")]))
    expect(fake.value?.models.map((item) => String(item.id))).toEqual(["kept", "new"])
  })

  test("无连接或首次发现未成功时不写入", () => {
    const fake = fakeProvider()
    applyProvider(fake.editor, { ready: false, models: [] })
    expect(fake.value).toBeUndefined()
  })
})
