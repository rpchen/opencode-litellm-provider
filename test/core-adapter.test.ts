import { expect, test } from "bun:test"
import litellm from "./fixtures/litellm-model-info.json" with { type: "json" }
import modelsDev from "./fixtures/models-dev.json" with { type: "json" }
import {
  buildModelSpecs as discover,
  normalizeLiteLLMURL,
  type Protocol,
} from "../src/generated/discovery-core/index.js"
import {
  buildModelSpecs,
  filterOperationalModelSpecs,
  modelFingerprint,
  toOpenCodeModelSpec,
} from "../src/host/models.js"
import { PROTOCOL_PACKAGES } from "../src/host/protocol.js"
import { normalizeLiteLLMURL as compatibilityURL } from "../src/core/litellm.js"
import type { Protocol as OptionsProtocol } from "../src/options.js"

const options = { contextTierCap: true, protocolOverrides: {} }

test("共享 ModelSpec 保持中立，OpenCode 适配只增加 SDK package", () => {
  const neutral = discover(litellm, modelsDev, options)
  const original = structuredClone(neutral)
  const operational = filterOperationalModelSpecs(neutral)
  const adapted = operational.map(toOpenCodeModelSpec)
  expect(neutral).toEqual(original)
  expect(adapted).toEqual(buildModelSpecs(litellm, modelsDev, options))
  for (const model of adapted) {
    const { package: sdk, ...metadata } = model
    const expected = operational.find((item) => item.id === model.id)
    if (!expected) throw new Error(`missing neutral fixture model: ${model.id}`)
    expect(metadata).toEqual(expected)
    expect(sdk).toBe(PROTOCOL_PACKAGES[model.protocol])
  }
  expect(neutral.every((model) => !Object.hasOwn(model, "package"))).toBe(true)
})

test("PR8 的总 context 语义贯穿 Core 到 OpenCode 模型", () => {
  const neutral = discover(litellm, modelsDev, options)
  const adapted = neutral.map(toOpenCodeModelSpec)
  const shared = adapted.find((model) => model.id === "shared-route")
  expect(shared?.limit).toEqual({ context: 1050000, input: 128000, output: 128000 })
  expect(shared?.package).toBe("@opencode/ai/providers/openai-compatible")
})

test("hy4-preview 通过 OpenRouter 能力 fallback 保持可用限制", () => {
  const neutral = discover({
    data: [{
      model_name: "hy4-preview",
      litellm_params: { model: "openai/hy4-preview" },
      model_info: {
        mode: "chat",
        input_cost_per_token: 0.000000834,
        output_cost_per_token: 0.000002501,
        cache_read_input_token_cost: 0.000000042,
      },
    }],
  }, {
    openrouter: {
      models: {
        "hy4-preview": {
          id: "hy4-preview",
          canonical_model_id: "tencent/hy4-preview",
          tool_call: true,
          reasoning: true,
          modalities: { input: ["text"], output: ["text"] },
          limit: { context: 1024000, output: 64000 },
        },
      },
    },
    opencode: {
      models: {
        "hy4-preview": {
          id: "hy4-preview",
          canonical_model_id: "tencent/hy4-preview",
          limit: { context: 1000000, output: 32000 },
        },
      },
    },
  }, options)
  const adapted = neutral.map(toOpenCodeModelSpec)
  const hy4 = adapted[0]!
  expect(hy4.limit).toEqual({ context: 1024000, input: 1024000, output: 64000 })
  expect(hy4.limit.context).toBeGreaterThan(0)
  expect(hy4.limit.output).toBeGreaterThan(0)
  expect(hy4.cost.input).toBeCloseTo(0.834)
  expect(hy4.cost.output).toBeCloseTo(2.501)
  expect(hy4.package).toBe("@opencode/ai/providers/openai-compatible")
})

test("非正数 operational limits 在 OpenCode adapter 边界被过滤", () => {
  const valid = {
    id: "valid",
    name: "valid",
    protocol: "chat" as const,
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: [],
    released: 0,
    releaseUnit: "none" as const,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    limit: { context: 128000, input: 128000, output: 32000 },
  }
  const zeroContext = {
    ...structuredClone(valid),
    id: "zero-context",
    name: "zero-context",
    limit: { context: 0, input: 0, output: 32000 },
  }
  const zeroOutput = {
    ...structuredClone(valid),
    id: "zero-output",
    name: "zero-output",
    limit: { context: 128000, input: 128000, output: 0 },
  }

  expect(filterOperationalModelSpecs([zeroContext, valid, zeroOutput]).map((item) => item.id)).toEqual(["valid"])
})

test("宿主 SDK 映射与迁移前完全相同，Protocol 来自公共入口", () => {
  const fromOptions = (protocol: OptionsProtocol): Protocol => protocol
  const fromCore = (protocol: Protocol): OptionsProtocol => protocol
  expect(fromOptions(fromCore("responses"))).toBe("responses")
  expect(PROTOCOL_PACKAGES).toEqual({
    chat: "@opencode/ai/providers/openai-compatible",
    responses: "@opencode/ai/providers/openai/responses",
    messages: "@opencode/ai/providers/anthropic",
  })
})

test("宿主字段仍参与共享指纹算法", () => {
  const models = buildModelSpecs(litellm, modelsDev, options)
  const changed = structuredClone(models)
  const first = changed[0]
  if (!first) throw new Error("fixture must contain conversational models")
  first.package = "test-only-different-sdk"
  expect(modelFingerprint(changed)).not.toBe(modelFingerprint(models))
})

test("生成的兼容入口直接复用公共入口，而非维护实现副本", () => {
  expect(compatibilityURL).toBe(normalizeLiteLLMURL)
})
