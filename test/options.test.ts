import { describe, expect, test } from "bun:test"
import { DEFAULT_OPTIONS, parseOptions } from "../src/options.js"

function logger() {
  const warnings: string[] = []
  return { warnings, warn: (message: string) => warnings.push(message) }
}

describe("parseOptions", () => {
  test("未配置时使用默认值", () => {
    expect(parseOptions(undefined)).toEqual(DEFAULT_OPTIONS)
  })

  test("轮询间隔最小钳制为 30 秒", () => {
    const log = logger()
    expect(parseOptions({ pollInterval: 5 }, log).pollInterval).toBe(30)
    expect(log.warnings).toHaveLength(1)
  })

  test("解析合法配置", () => {
    expect(
      parseOptions({
        pollInterval: 90,
        contextTierCap: false,
        protocolOverrides: { "glm-5.3": "chat", claude: "messages" },
        conversationFeedback: true,
      }),
    ).toEqual({
      pollInterval: 90,
      contextTierCap: false,
      protocolOverrides: { "glm-5.3": "chat", claude: "messages" },
      conversationFeedback: true,
    })
  })

  test("conversationFeedback 默认关闭", () => {
    expect(parseOptions(undefined).conversationFeedback).toBe(false)
    expect(parseOptions({ pollInterval: 90 }).conversationFeedback).toBe(false)
  })

  test("conversationFeedback 开启", () => {
    expect(parseOptions({ conversationFeedback: true }).conversationFeedback).toBe(true)
  })

  test("conversationFeedback 非法值回退关闭并警告", () => {
    const log = logger()
    const options = parseOptions({ conversationFeedback: "yes" }, log)
    expect(options.conversationFeedback).toBe(false)
    expect(log.warnings).toEqual(["conversationFeedback 必须是布尔值，已使用默认值 false"])
  })

  test("非法项回退默认值并警告", () => {
    const log = logger()
    const options = parseOptions(
      {
        pollInterval: "快",
        contextTierCap: "yes",
        protocolOverrides: { good: "responses", bad: "completion", "": "chat" },
      },
      log,
    )

    expect(options).toEqual({
      pollInterval: 300,
      contextTierCap: true,
      protocolOverrides: { good: "responses" },
      conversationFeedback: false,
    })
    expect(log.warnings).toHaveLength(4)
  })
})


describe("PR9 endpoint options", () => {
  test("解析显式 endpoints 并让 protocolOverrides 保持 endpoint 级", () => {
    expect(parseOptions({
      pollInterval: 60,
      endpoints: {
        default: { baseUrl: "https://primary.example", protocolOverrides: { gpt: "responses" } },
        company: { baseUrl: "https://company.example", protocolOverrides: { claude: "messages" } },
      },
    })).toMatchObject({
      pollInterval: 60,
      endpoints: {
        default: { baseUrl: "https://primary.example", protocolOverrides: { gpt: "responses" } },
        company: { baseUrl: "https://company.example", protocolOverrides: { claude: "messages" } },
      },
    })
  })

  test("显式 endpoints 与顶层 protocolOverrides 共存时拒绝 endpoint 内容", () => {
    const log = logger()
    const options = parseOptions({
      protocolOverrides: { gpt: "chat" },
      endpoints: { company: { baseUrl: "https://company.example" } },
    }, log)
    expect(options.endpoints).toEqual({})
    expect(log.warnings.some((message) => message.includes("不能同时"))).toBeTrue()
  })

  test("[VALIDATION-INVALID-PRESERVED] 非法 endpoint id 仍被丢弃；非法 baseUrl 保留为 invalid", () => {
    const options = parseOptions({
      endpoints: {
        "team-a": { baseUrl: "https://a.example" },
        "team_2": { baseUrl: "https://b.example" },
        "Team A": { baseUrl: "https://bad.example" },
        broken: { baseUrl: "ftp://bad.example" },
      },
    }, { warn: () => {} })
    expect(Object.keys(options.endpoints ?? {}).sort()).toEqual(["broken", "team-a", "team_2"])
    expect(options.endpoints?.["team-a"]?.validation?.kind ?? "ok").toBe("ok")
    expect(options.endpoints?.broken?.validation?.kind).toBe("invalid")
    // Runtime never receives the raw invalid URL.
    expect(options.endpoints?.broken?.baseUrl).toBe("")
    expect(options.endpoints?.broken?.invalidBaseUrl).toBe("ftp://bad.example")
  })
})
