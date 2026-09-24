import { describe, expect, test } from "bun:test"
import litellmFixture from "./fixtures/litellm-model-info.json" with { type: "json" }
import modelsDevFixture from "./fixtures/models-dev.json" with { type: "json" }

const FORBIDDEN_KEYS = new Set([
  "api_base",
  "litellm_credential_name",
  "tags",
  "access_via_team_ids",
  "access_groups",
  "id",
  "api_key",
])

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys)
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      keys.add(key)
      collectKeys(item, keys)
    }
  }
  return keys
}

describe("fixtures", () => {
  test("LiteLLM 样本不含敏感字段或 Key", () => {
    const keys = collectKeys(litellmFixture)
    for (const forbidden of FORBIDDEN_KEYS) expect(keys.has(forbidden)).toBeFalse()
    expect(JSON.stringify(litellmFixture)).not.toMatch(/sk-[A-Za-z0-9_-]+/)
  })

  test("LiteLLM 样本覆盖关键部署类型", () => {
    const data = litellmFixture.data
    expect(data.some((item) => item.model_info?.mode === "chat")).toBeTrue()
    expect(data.some((item) => item.model_info?.mode === "responses")).toBeTrue()
    expect(data.some((item) => item.model_info?.mode === "embedding")).toBeTrue()
    expect(data.some((item) => item.model_info?.mode === "image_generation")).toBeTrue()
    expect(JSON.stringify(data)).toContain("above_272k_tokens")
    expect(JSON.stringify(data)).toContain("above_512k_tokens")
  })

  test("models.dev 样本可解析并覆盖选择与档位来源", () => {
    expect(modelsDevFixture.openai.models["gpt-5.5"].reasoning_options[0]?.type).toBe("effort")
    expect(modelsDevFixture.anthropic.models["claude-sonnet-4-5"].reasoning_options[0]?.max).toBe(64000)
    expect(modelsDevFixture.anthropic.models["claude-opus-4-1"].reasoning_options[0]).toEqual({
      type: "budget_tokens",
    })
    expect(modelsDevFixture.zai.models["glm-5.3"].reasoning_options[0]?.type).toBe("toggle")
    expect(modelsDevFixture.minimax.models["MiniMax-M3"].id).toBe("MiniMax-M3")
    expect(modelsDevFixture["reseller-a"].models["shared-model"]).toBeDefined()
    expect(modelsDevFixture["reseller-b"].models["shared-model"]).toBeDefined()
  })
})
