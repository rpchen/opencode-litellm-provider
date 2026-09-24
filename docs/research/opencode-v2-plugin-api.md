# OpenCode v2 插件 API 调研（基于 2.0.15）

调研日期：2026-09-23。来源：npm 包 `@opencode/plugin@2.0.15` 的 `.d.ts`、`@opencode/schema@2.0.15`，
以及上游源码仓库 `github.com/anomalyco/opencode` 的 **`beta` 分支**。

> **“上游”指什么**：OpenCode 的官方源码仓库 `anomalyco/opencode`。其中：
> - `beta` 分支：发布 v2 包（`@opencode/plugin`、`@opencode/core`、`@opencode/cli` 2.x），与本机 opencode v2.0.15 对应，**以它为准**。
> - `dev` 分支：仍是 v1 线（`@opencode-ai/plugin` 1.18.x），里面的 `ctx.catalog.transform` 等写法属于 v1 线内部实验，**不适用**于本项目。

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

## 4. 已确认的结论（beta 源码）

1. **baseURL 走 `settings`**：`Provider.Info.settings` / `Model.Info.settings` 是开放记录（`StructWithRest`，可加任意键）。
   `packages/core/src/aisdk.ts` 的 `prepareOptions` 把 `model.settings` 原样展开进 AI SDK 工厂参数
   （`createOpenAI(options)` / `createAnthropic(options)` / `createOpenAICompatible(options)`），因此
   `settings.baseURL` 即为请求地址。无需扩展 schema，也无需自建 SDK。
2. **key 表单可带自定义字段，且自动投影**：`IntegrationKeyMethod.form` 支持 string（含 `format: "uri"`、`placeholder`、`default`、`pattern`）、
   number、boolean、select（`options`）、multiselect 等字段。用户提交的答案存为 `Credential.Key.configuration`。
   `packages/core/src/model-resolver.ts` 在调用时合并：`settings ← { apiKey: credential.key, ...credential.metadata, ...configuration }`。
   → 表单字段 key 取名 `baseURL`，就会**自动**成为每个模型请求的 `settings.baseURL`；API Key 自动成为 `apiKey`。
   插件在发现阶段通过 `ctx.integration.connection.active/resolve` 读到同样的 key 和 `configuration.baseURL`。
3. **公开 API 就是 beta 实际实现**：beta 的 `packages/plugin/src/promise/adapter.ts` 确实提供 `ctx.provider.transform`、`ctx.model.transform`，
   与已发布的 `.d.ts` 一致。

## 5. 实施与验收结论

1. 一个 `litellm` integration 可以绑定一个 provider，并通过模型级 `package` 在同一 provider 内选择 Chat / Responses / Messages；用户只需连接一次。
2. Chat 使用 `@opencode/ai/providers/openai-compatible`；Responses 使用 `@opencode/ai/providers/openai-compatible-responses`，后者已在 OpenCode 2.0.15 真实调用成功。当前验收环境没有 Messages 部署，`anthropic-compatible` 留待首次真实使用时复核。
3. LiteLLM 没有推送模型清单；实现采用启动发现、连接变更事件和定时轮询，并以稳定指纹避免无变化时重复 reload。
4. 协议依次依据用户覆盖、Anthropic/Claude 识别、`supported_endpoints`、`mode` 判定；不向每个模型发探测请求。完整验收结果见 `docs/research/acceptance-notes.md`。

## 6. 行为基线：opencode-litellm-config-sync（v1 静态生成脚本）

位置：`~/.agents/skills/opencode-litellm-config-sync/`（Python，~750 行）。要点：

- 模型清单与元数据：LiteLLM `/v1/model/info` 为主；models.dev 仅补缺，只取对应一方厂商记录，缺失时退到 OpenCode Zen（`opencode`），再退到唯一厂商记录，绝不跨记录合并。
- GPT 上下文窗：以 Codex `models_cache.json` 为准（`context_window * effective_context_window_percent / 100`）。
- 只保留 chat 模型，排除 embedding / image generation。
- provider 拆分：`litellm`（`@ai-sdk/openai-compatible`，chat）、`litellm-openai`（`@ai-sdk/openai`，responses）、`litellm-anthropic`（`@ai-sdk/anthropic`，messages，按 LiteLLM 路由 `anthropic/*` 判定）。
- variants：OpenAI 兼容路由把 models.dev `type: effort` 映射为 `reasoningEffort`；Anthropic 路由映射为 `effort`；`budget_tokens` 生成 `high`(16000) 与 `max`（models.dev 声明的最大值）；`toggle` 不生成 variant；不把 LiteLLM 内部字段（如 `supports_minimal_reasoning_effort`）直接当 variant；`reasoning: true` 且无 variants 是合法终态。
- 发现用高权限 key，但写入 opencode 配置的是用户自己的 key（插件形态下需重新审视：发现与调用共用用户 key）。
