import { describe, expect, test } from "bun:test"
import modelsDev from "./fixtures/models-dev.json" with { type: "json" }
import { groupLiteLLMDeployments } from "../src/core/litellm.js"
import {
  buildVariants,
  candidateModelIDs,
  selectModelsDevRecord,
} from "../src/core/modelsdev.js"

function one(modelName: string, model: string, info: Record<string, unknown> = {}) {
  return groupLiteLLMDeployments({
    data: [{ model_name: modelName, litellm_params: { model }, model_info: { mode: "chat", ...info } }],
  })[0]!
}

describe("models.dev 记录选择", () => {
  test("候选顺序为 base_model、去路由前缀、model_name", () => {
    expect(candidateModelIDs(one("route-name", "openai/upstream", { base_model: "base" }))).toEqual([
      "base",
      "upstream",
      "route-name",
    ])
  })

  test("大小写不敏感地优先原厂记录", () => {
    const selected = selectModelsDevRecord(
      one("minimax-m3", "openai/minimax-m3", { base_model: "minimax-m3" }),
      modelsDev,
    )
    expect(selected?.providerID).toBe("minimax")
    expect(selected?.modelID).toBe("MiniMax-M3")
  })

  test("原厂缺失时使用 OpenCode Zen", () => {
    const selected = selectModelsDevRecord(one("kimi-k2.6", "openai/kimi-k2.6"), modelsDev)
    expect(selected?.providerID).toBe("opencode")
  })

  test("显式 models_dev_provider 覆盖家族识别", () => {
    const selected = selectModelsDevRecord(
      one("route", "openai/glm-fallback", { models_dev_provider: "zhipuai" }),
      modelsDev,
    )
    expect(selected?.providerID).toBe("zhipuai")
  })

  test("只有多个转售商时不选择记录，且不模糊去后缀", () => {
    expect(selectModelsDevRecord(one("shared-model", "custom/shared-model"), modelsDev)).toBeUndefined()
    expect(selectModelsDevRecord(one("gpt-5.5-free", "openai/gpt-5.5-free"), modelsDev)).toBeUndefined()
  })
})

describe("推理档位", () => {
  test("effort 按协议写入选项键", () => {
    const selected = selectModelsDevRecord(one("gpt-5.5", "openai/gpt-5.5"), modelsDev)
    expect(buildVariants(selected, "responses")).toEqual([
      { id: "none", settings: { reasoningEffort: "none" } },
      { id: "low", settings: { reasoningEffort: "low" } },
      { id: "medium", settings: { reasoningEffort: "medium" } },
      { id: "high", settings: { reasoningEffort: "high" } },
      { id: "xhigh", settings: { reasoningEffort: "xhigh" } },
    ])
  })

  test("Messages budget 生成 high 与 max，无 max 时只生成 high", () => {
    const withMax = selectModelsDevRecord(one("claude-sonnet-4-5", "anthropic/claude-sonnet-4-5"), modelsDev)
    const withoutMax = selectModelsDevRecord(one("claude-opus-4-1", "anthropic/claude-opus-4-1"), modelsDev)
    expect(buildVariants(withMax, "messages")).toEqual([
      { id: "high", settings: { thinking: { type: "enabled", budgetTokens: 16000 } } },
      { id: "max", settings: { thinking: { type: "enabled", budgetTokens: 64000 } } },
    ])
    expect(buildVariants(withoutMax, "messages")).toEqual([
      { id: "high", settings: { thinking: { type: "enabled", budgetTokens: 16000 } } },
    ])
  })

  test("toggle 与非 Messages budget 不生成档位", () => {
    const toggle = selectModelsDevRecord(one("glm-5.3", "openai/glm-5.3"), modelsDev)
    const budget = selectModelsDevRecord(one("claude-sonnet-4-5", "anthropic/claude-sonnet-4-5"), modelsDev)
    expect(buildVariants(toggle, "chat")).toEqual([])
    expect(buildVariants(budget, "chat")).toEqual([])
  })
})
