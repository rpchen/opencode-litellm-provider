import { expect, test } from "bun:test"
import litellm from "./fixtures/litellm-model-info.json" with { type: "json" }
import modelsDev from "./fixtures/models-dev.json" with { type: "json" }
import {
  buildModelSpecs as discover,
  normalizeLiteLLMURL,
  type Protocol,
} from "../src/generated/discovery-core/index.js"
import { buildModelSpecs, modelFingerprint, toOpenCodeModelSpec } from "../src/host/models.js"
import { PROTOCOL_PACKAGES } from "../src/host/protocol.js"
import { normalizeLiteLLMURL as compatibilityURL } from "../src/core/litellm.js"
import type { Protocol as OptionsProtocol } from "../src/options.js"

const options = { contextTierCap: true, protocolOverrides: {} }

test("共享 ModelSpec 保持中立，OpenCode 适配只增加 SDK package", () => {
  const neutral = discover(litellm, modelsDev, options)
  const original = structuredClone(neutral)
  const adapted = neutral.map(toOpenCodeModelSpec)
  expect(neutral).toEqual(original)
  expect(adapted).toEqual(buildModelSpecs(litellm, modelsDev, options))
  for (const model of adapted) {
    const { package: sdk, ...metadata } = model
    expect(metadata).toEqual(neutral.find((item) => item.id === model.id))
    expect(sdk).toBe(PROTOCOL_PACKAGES[model.protocol])
  }
  expect(neutral.every((model) => !Object.hasOwn(model, "package"))).toBe(true)
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
