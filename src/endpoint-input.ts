/** Pure endpoint input validation shared by the server config writer and the TUI prompts. */
import { isEndpointID } from "./generated/discovery-core/index.js"
import { normalizeLiteLLMURL } from "./core/litellm.js"

export function validateEndpointId(id: string): string | undefined {
  return isEndpointID(id) ? undefined : "Endpoint ID 必须匹配 [a-z0-9][a-z0-9-_]*"
}

export type UrlCheck = { ok: true; value: string } | { ok: false; message: string }

export function validateBaseUrl(raw: string): UrlCheck {
  const value = raw.trim()
  if (value.length === 0) return { ok: false, message: "Base URL 不能为空" }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { ok: false, message: "Base URL 必须是合法的 http(s) 地址" }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, message: "Base URL 必须使用 http:// 或 https://" }
  try {
    normalizeLiteLLMURL(value)
  } catch {
    return { ok: false, message: "Base URL 不能包含用户名/密码等凭据信息" }
  }
  return { ok: true, value }
}

export type ApiKeyCheck = { ok: true; key: string } | { ok: false; message: string }

export function validateApiKey(raw: string): ApiKeyCheck {
  const key = raw.trim()
  if (key.length === 0) return { ok: false, message: "API Key 不能为空" }
  if (/[\s\u0000-\u001f\u007f]/u.test(key)) return { ok: false, message: "API Key 不能包含空白或控制字符" }
  return { ok: true, key }
}
