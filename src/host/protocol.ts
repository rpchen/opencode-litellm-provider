import type { Protocol } from "../generated/discovery-core/index.js"

// Host SDK entry points are an OpenCode contract, not shared discovery metadata.
export const PROTOCOL_PACKAGES: Record<Protocol, string> = {
  chat: "@opencode/ai/providers/openai-compatible",
  responses: "@opencode/ai/providers/openai/responses",
  messages: "@opencode/ai/providers/anthropic",
}
