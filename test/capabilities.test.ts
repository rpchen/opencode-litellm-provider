import { describe, expect, test } from "bun:test"
import litellm from "./fixtures/litellm-model-info.json" with { type: "json" }
import modelsDev from "./fixtures/models-dev.json" with { type: "json" }
import { mapCapabilities } from "../src/core/capabilities.js"
import { groupLiteLLMDeployments } from "../src/core/litellm.js"
import { selectModelsDevRecord } from "../src/core/modelsdev.js"

const groups = groupLiteLLMDeployments(litellm)
function mapped(modelName: string, contextTierCap = true) {
  const group = groups.find((item) => item.modelName === modelName)!
  return mapCapabilities(group, selectModelsDevRecord(group, modelsDev), contextTierCap)
}

describe("能力映射", () => {
  test("多部署按交集与最小上限保守合并", () => {
    const result = mapped("gpt-5.5")
    expect(result.capabilities).toEqual({
      tools: true,
      input: ["text", "image", "pdf"],
      output: ["text"],
    })
    expect(result.limit.output).toBe(64000)
  })

  test("LiteLLM 值优先、价格换算为每百万 token", () => {
    const result = mapped("gpt-5.5")
    expect(result.cost).toEqual({ input: 2.5, output: 10, cacheRead: 0.25, cacheWrite: 3 })
  })

  test("272k 与 512k 阶梯截断，可关闭", () => {
    expect(mapped("gpt-5.5").limit.context).toBe(272000)
    expect(mapped("minimax-m3").limit.context).toBe(512000)
    expect(mapped("gpt-5.5", false).limit.context).toBe(900000)
  })

  test("tiered_pricing 首个非零起点截断", () => {
    expect(mapped("qwen3.7-plus").limit.context).toBe(256000)
  })

  test("模态信任名单允许 models.dev 补充 Qwen 输入模态", () => {
    expect(mapped("qwen3.7-plus").capabilities.input).toEqual(["text", "image", "video"])
  })

  test("异常字段按缺失处理并回退默认值", () => {
    const result = mapped("invalid-fields")
    expect(result.limit).toEqual({ context: 0, input: 0, output: 0 })
    expect(result.capabilities.tools).toBeTrue()
  })
})
