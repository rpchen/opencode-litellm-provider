# OpenCode v2 插件 API 调研（基于 2.0.15）

调研日期：2026-09-23。来源：npm 包 `@opencode/plugin@2.0.15` 的 `.d.ts`、`@opencode/schema@2.0.15`，
以及上游 `anomalyco/opencode` 分支 `dev` 下 `packages/core/src/plugin/`。

## 1. 包与加载

- v2 插件 SDK 是 **`@opencode/plugin`**（与 v2 CLI `@opencode/cli` 同版本号）。
  `@opencode-ai/plugin`（1.x）是 v1 的包，不要混用。
- 入口：`import { Plugin } from "@opencode/plugin"`，默认导出 `Plugin.define({ id, setup(ctx) })`。
  `setup` 可返回 cleanup 函数。另有 `@opencode/plugin/effect` 的 Effect 版本 API。
- 宿主通过配置 `plugins` 数组加载外部包（`@opencode/schema` → `config/plugin.js`）：
  ```jsonc
  { "plugins": [ "some-plugin", { "package": "opencode-litellm-provider", "options": { /* 任意 */ } } ] }
  ```
  `options` 在 `setup` 中以 `ctx.options` 读取。上游 `config/plugin/external.ts` 会 `npm.add` 后 `import`，
  若默认导出无 `effect` 字段则用 `fromPromise` 适配 Promise 插件。

## 2. 与本项目相关的 ctx 域

| 域 | 能力 | 用途 |
|---|---|---|
| `ctx.integration.transform(editor => …)` | 注册 integration 及认证方式：`{ type: "key", form? }`、`{ type: "env", names }`、oauth、command | 让用户在 UI 中像其他 provider 一样“连接 LiteLLM、填 API Key”（form 可加 baseURL 字段，待验证） |
| `ctx.integration.connection.active(id)` / `.resolve(conn)` | 取当前连接与凭据 | 拿到用户填的 key（及 form 元数据）用于发现请求 |
| `ctx.provider.transform(editor => …)` | `ProviderEditor.add({ info, models, sourceConnection })`、`update`、`remove`、`models.set/update/remove` | 动态注册多个 provider 及其模型清单 |
| `ctx.model.transform(editor => …)` | 调整模型、设默认模型 | 可选 |
| `ctx.provider.reload()` / `ctx.model.reload()` | 触发 transform 重新执行 | 变更检测后刷新 |
| `ctx.aisdk.hook("sdk" \| "language", cb, { providerID })` | 自定义 SDK 实例 / 选择 LanguageModel | 决定走 chat / responses / messages（例如对 `@ai-sdk/openai` 选 `.chat()` 还是 `.responses()`） |
| `ctx.event` | 事件订阅 | 监听连接变更（上游 opencode 插件监听 `Integration.Event.ConnectionUpdated`） |

`Transform<T>` 返回 `Registration`（带 `dispose`）；transform 回调是**同步**的，异步发现需先在外部完成、缓存结果，
再在回调中写入，然后 `reload()` —— 上游 `plugin/provider/opencode.ts` 正是此模式（`load()` 拉取 → 缓存 → `catalog.reload()`）。

## 3. 数据结构（`@opencode/schema`）

**Provider.Info**：`id`、`canonical?`、`integrationID?`、`name`、`activation: "auto"|"enabled"|"disabled"`、
`package`（AI SDK npm 包名）、`settings?`（timeout / chunkTimeout / compaction / transport + 任意键）、`headers?`、`body?`。

**Model.Info**：`id`、`modelID`、`providerID`、`family?`、`name`、`package?`（模型级覆盖 provider 包）、
`compatibility?`（reasoningField / maxTokensField / requireReasoning …）、`settings?/headers?/body?`、
`capabilities: { tools, input[], output[] }`、`variants: { id, settings?, headers?, body? }[]`、
`time.released`、`cost[]`（USD/百万 token，可按上下文分档）、`status`、`enabled`、
`limit: { context, input?, output }`。`Model.Info.default(providerID, id)` 给出默认值。

## 4. 待验证的开放问题（首个变更的 spike 范围）

1. **baseURL 放哪**：公开 `Provider.Info` 无 `url` 字段；上游内部 `catalog` 使用 `provider.api = { type: "aisdk", package, url }`。
   需确认 Promise API 下是通过 `body.baseURL` / `settings` 传给 AI SDK 工厂，还是需 `aisdk.hook("sdk")` 自建实例。
2. **公开 API 与上游内部 API 的差异**：上游官方插件用 `ctx.catalog.transform`（内部），公开包暴露的是
   `ctx.provider.transform` + `ctx.model.transform`，语义映射需在真实 v2 中验证。
3. **key 表单能否带 baseURL**：`IntegrationKeyMethod.form` 的字段类型（`@opencode/schema/form`）及其值在
   `Credential` 中的落点（`metadata`?）。
4. **变更检测方式**：LiteLLM 无推送；候选为定时轮询 `/v1/model/info` 做内容哈希比较 + 连接变更事件 + 手动命令（`ctx.command`）。
5. **协议判定依据**：LiteLLM `/v1/model/info` 中的 `litellm_params.model` 路由前缀、`model_info.mode`、
   以及 LiteLLM 是否对该模型开放 `/v1/responses`、`/v1/messages` 透传。

## 5. 行为基线：opencode-litellm-config-sync（v1 静态生成脚本）

位置：`~/.agents/skills/opencode-litellm-config-sync/`（Python，~750 行）。要点：

- 模型清单与元数据：LiteLLM `/v1/model/info` 为主；models.dev 仅补缺，只取对应一方厂商记录，缺失时退到 OpenCode Zen（`opencode`），再退到唯一厂商记录，绝不跨记录合并。
- GPT 上下文窗：以 Codex `models_cache.json` 为准（`context_window * effective_context_window_percent / 100`）。
- 只保留 chat 模型，排除 embedding / image generation。
- provider 拆分：`litellm`（`@ai-sdk/openai-compatible`，chat）、`litellm-openai`（`@ai-sdk/openai`，responses）、`litellm-anthropic`（`@ai-sdk/anthropic`，messages，按 LiteLLM 路由 `anthropic/*` 判定）。
- variants：OpenAI 兼容路由把 models.dev `type: effort` 映射为 `reasoningEffort`；Anthropic 路由映射为 `effort`；`budget_tokens` 生成 `high`(16000) 与 `max`（models.dev 声明的最大值）；`toggle` 不生成 variant；不把 LiteLLM 内部字段（如 `supports_minimal_reasoning_effort`）直接当 variant；`reasoning: true` 且无 variants 是合法终态。
- 发现用高权限 key，但写入 opencode 配置的是用户自己的 key（插件形态下需重新审视：发现与调用共用用户 key）。
