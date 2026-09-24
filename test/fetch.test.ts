import { afterEach, describe, expect, test } from "bun:test"
import { normalizeLiteLLMURL } from "../src/core/litellm.js"
import {
  DiscoveryError,
  fetchJSON,
  fetchLiteLLMModelInfo,
  getModelsDevCatalog,
  redact,
  resetModelsDevCacheForTest,
  type FetchLike,
} from "../src/net/fetch.js"

const KEY = "sk-secret-value"

function response(status: number, body = "{}") {
  return new Response(body, { status, headers: { "content-type": "application/json" } })
}

async function errorKind(status: number) {
  const fetchImpl: FetchLike = async () => response(status)
  try {
    await fetchJSON({ url: "https://litellm.example/v1/model/info", key: KEY, timeoutMs: 100, fetchImpl })
  } catch (error) {
    return error as DiscoveryError
  }
  throw new Error("预期请求失败")
}

describe("fetchJSON", () => {
  test.each([
    [401, "auth"],
    [403, "auth"],
    [404, "notfound"],
    [429, "ratelimit"],
    [500, "server"],
    [302, "redirect"],
  ] as const)("把状态 %s 分类为 %s", async (status, kind) => {
    expect((await errorKind(status)).kind).toBe(kind)
  })

  test("网络错误与解析错误分类", async () => {
    const network: FetchLike = async () => {
      throw new Error(`连接失败 ${KEY}`)
    }
    await expect(
      fetchJSON({ url: "https://litellm.example", key: KEY, timeoutMs: 100, fetchImpl: network }),
    ).rejects.toMatchObject({ kind: "network" })

    const invalid: FetchLike = async () => response(200, "private response body")
    await expect(
      fetchJSON({ url: "https://litellm.example", key: KEY, timeoutMs: 100, fetchImpl: invalid }),
    ).rejects.toMatchObject({ kind: "parse" })
  })

  test("错误信息不含 Key 或响应体", async () => {
    const invalid: FetchLike = async () => response(200, `private body ${KEY}`)
    try {
      await fetchJSON({ url: `https://user:${KEY}@litellm.example`, key: KEY, timeoutMs: 100, fetchImpl: invalid })
    } catch (error) {
      const message = (error as Error).message
      expect(message).not.toContain(KEY)
      expect(message).not.toContain("private body")
      expect(message).toContain("litellm.example")
    }
    expect(redact(`token=${KEY}`, KEY)).toBe("token=sk-***")
  })

  test("请求设置手动重定向并以 Bearer 携带 Key", async () => {
    let init: RequestInit | undefined
    const fetchImpl: FetchLike = async (_input, received) => {
      init = received
      return response(200, "{\"data\":[]}")
    }
    await fetchJSON({ url: "https://litellm.example", key: KEY, timeoutMs: 100, fetchImpl })
    expect(init?.redirect).toBe("manual")
    expect(init?.headers).toEqual({ Authorization: `Bearer ${KEY}` })
  })
})

describe("fetchLiteLLMModelInfo", () => {
  test("/v1/model/info 为 404 时回退 /model/info", async () => {
    const urls: string[] = []
    const fetchImpl: FetchLike = async (input) => {
      urls.push(String(input))
      return urls.length === 1 ? response(404) : response(200, "{\"data\":[]}")
    }
    const result = await fetchLiteLLMModelInfo(normalizeLiteLLMURL("https://litellm.example"), KEY, fetchImpl)
    expect(result).toEqual({ data: [] })
    expect(urls).toEqual([
      "https://litellm.example/v1/model/info",
      "https://litellm.example/model/info",
    ])
  })
})

describe("models.dev 缓存", () => {
  afterEach(resetModelsDevCacheForTest)

  test("成功结果缓存 6 小时", async () => {
    let calls = 0
    let now = 1_000
    const fetchImpl: FetchLike = async () => {
      calls += 1
      return response(200, "{\"openai\":{}}")
    }
    const options = { fetchImpl, now: () => now }
    expect(await getModelsDevCatalog(options)).toEqual({ openai: {} })
    now += 6 * 60 * 60 * 1000 - 1
    expect(await getModelsDevCatalog(options)).toEqual({ openai: {} })
    expect(calls).toBe(1)
  })

  test("失败返回空目录，退避期内不重复请求", async () => {
    let calls = 0
    let now = 2_000
    const warnings: string[] = []
    const fetchImpl: FetchLike = async () => {
      calls += 1
      throw new Error("offline")
    }
    const options = { fetchImpl, now: () => now, logger: { warn: (message: string) => warnings.push(message) } }
    expect(await getModelsDevCatalog(options)).toEqual({})
    now += 59_999
    expect(await getModelsDevCatalog(options)).toEqual({})
    expect(calls).toBe(1)
    expect(warnings).toHaveLength(1)
  })
})
