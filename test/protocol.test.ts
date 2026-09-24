import { describe, expect, test } from "bun:test"
import { groupLiteLLMDeployments } from "../src/core/litellm.js"
import { deploymentProtocol, PROTOCOL_PACKAGES, resolveProtocol } from "../src/core/protocol.js"

function group(data: Record<string, unknown>[]) {
  return groupLiteLLMDeployments({ data })[0]!
}

function deployment(modelInfo: Record<string, unknown>, model = "openai/model") {
  return group([{ model_name: "model", litellm_params: { model }, model_info: modelInfo }]).deployments[0]!
}

describe("协议判定", () => {
  test("mode responses 与 chat", () => {
    expect(deploymentProtocol(deployment({ mode: "responses" }))).toBe("responses")
    expect(deploymentProtocol(deployment({ mode: "chat" }))).toBe("chat")
  })

  test("Anthropic 上游与 Bedrock Claude 使用 Messages", () => {
    expect(deploymentProtocol(deployment({ mode: "chat" }, "anthropic/claude-sonnet-4-5"))).toBe("messages")
    expect(
      deploymentProtocol(
        deployment(
          { mode: "chat", base_model: "claude-sonnet-4-5", litellm_provider: "bedrock" },
          "bedrock/anthropic.claude-sonnet-4-5",
        ),
      ),
    ).toBe("messages")
  })

  test("supported_endpoints 多协议时 Responses 优先且优先于 mode", () => {
    expect(
      deploymentProtocol(
        deployment({
          mode: "chat",
          supported_endpoints: ["/v1/chat/completions", "/v1/responses"],
        }),
      ),
    ).toBe("responses")
  })

  test("无效端点声明被忽略", () => {
    expect(
      deploymentProtocol(deployment({ mode: "responses", supported_endpoints: ["/v1/realtime"] })),
    ).toBe("responses")
  })

  test("同名部署协议不一致时回退 Chat", () => {
    const mixed = group([
      {
        model_name: "model",
        litellm_params: { model: "anthropic/claude-haiku" },
        model_info: { mode: "chat" },
      },
      {
        model_name: "model",
        litellm_params: { model: "openai/gpt" },
        model_info: { mode: "responses" },
      },
    ])
    expect(resolveProtocol(mixed)).toBe("chat")
  })

  test("用户覆盖优先，未知模型覆盖自然忽略", () => {
    const responses = group([
      { model_name: "model", litellm_params: { model: "openai/model" }, model_info: { mode: "responses" } },
    ])
    expect(resolveProtocol(responses, { model: "chat", missing: "messages" })).toBe("chat")
  })

  test("协议包映射集中且完整", () => {
    expect(PROTOCOL_PACKAGES).toEqual({
      chat: "@opencode/ai/providers/openai-compatible",
      responses: "@opencode/ai/providers/openai-compatible-responses",
      messages: "@opencode/ai/providers/anthropic-compatible",
    })
  })
})
