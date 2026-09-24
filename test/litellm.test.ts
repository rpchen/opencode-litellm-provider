import { describe, expect, test } from "bun:test"
import fixture from "./fixtures/litellm-model-info.json" with { type: "json" }
import { groupLiteLLMDeployments, normalizeLiteLLMURL } from "../src/core/litellm.js"

describe("normalizeLiteLLMURL", () => {
  test.each([
    "http://litellm.example:4000",
    "http://litellm.example:4000/",
    "http://litellm.example:4000/v1",
    "http://litellm.example:4000/v1/",
  ])("规范化 %s", (input) => {
    expect(normalizeLiteLLMURL(input)).toEqual({
      rootURL: "http://litellm.example:4000",
      apiBaseURL: "http://litellm.example:4000/v1",
      modelInfoURL: "http://litellm.example:4000/v1/model/info",
      legacyModelInfoURL: "http://litellm.example:4000/model/info",
    })
  })

  test.each(["file:///etc/passwd", "ftp://litellm.example", "不是地址"])("拒绝非 http(s) 地址 %s", (input) => {
    expect(() => normalizeLiteLLMURL(input)).toThrow(/http 或 https/)
  })
})

describe("groupLiteLLMDeployments", () => {
  test("按真实部署聚合并过滤非对话模型", () => {
    const groups = groupLiteLLMDeployments(fixture)
    expect(groups.find((group) => group.modelName === "gpt-5.5")?.deployments).toHaveLength(2)
    expect(groups.map((group) => group.modelName)).not.toContain("text-embedding-v4")
    expect(groups.map((group) => group.modelName)).not.toContain("gpt-image-2")
    expect(groups.map((group) => group.modelName)).not.toContain("dall-e-3")
    expect(groups.map((group) => group.modelName)).toContain("qwen3.7-plus")
  })

  test("成功空响应产生空清单", () => {
    expect(groupLiteLLMDeployments({ data: [] })).toEqual([])
  })

  test("缺 model_name 时跳过，字段异常不影响其他部署", () => {
    const groups = groupLiteLLMDeployments({
      data: [
        { model_info: { mode: "chat" } },
        { model_name: "valid", model_info: { mode: "chat", max_input_tokens: "abc" } },
      ],
    })
    expect(groups.map((group) => group.modelName)).toEqual(["valid"])
  })
})
