# OpenCode v2 插件 API 调研（基于 2.0.15）

调研日期：2026-09-23。来源：npm 包 `@opencode/plugin@2.0.15` 的 `.d.ts`、`@opencode/schema@2.0.15`，
以及上游源码仓库 `github.com/anomalyco/opencode` 的 **`beta` 分支**。

> **“上游”指什么**：OpenCode 的官方源码仓库 `anomalyco/opencode`。其中：
> **2026-09-25 更正**：本节原先记的“`beta` 分支为 v2 线、`dev` 仍是 v1 线”是 2026-09-23 的快照结论，**现已过时**。当前上游默认分支 `dev` 已包含完整 v2 线代码：`packages/core`（Effect 服务，含 `command.ts`、`session/message-updater.ts`、`session/runner/`）与 `packages/app`（Desktop/Web 前端，含 `components/prompt-input/submit.ts`、`context/global-sync/bootstrap.ts`）；`2.0` 分支反而没有 `packages/core`。核对上游时以**实际 commit** 为准，不要依赖分支名推断版本线。

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

### 2.1 会话消息通道与客户端渲染差异（2026-09-25 补充）

对话反馈能力（`add-conversation-feedback-channel`）核查所得，含源码级证据：

| 通道 | TUI 时间线 | Desktop/Web 时间线 | 模型可见 | 证据 |
|---|---|---|---|---|
| `ctx.session.prompt` 提交的 user 消息 | 渲染 | 渲染 | 是 | TUI `packages/tui/src/routes/session/index.tsx` 按 `message.role === "user" / "assistant"` 分支渲染；app `packages/app/src/pages/session/message-timeline.tsx` 同样按 role 渲染 |
| `ctx.session.synthetic` | **不渲染** | **不渲染** | 是（下次运行时） | `SessionMessage.Synthetic`（`@opencode/schema/dist/session-message.d.ts`）无 role 字段；`core/src/session/message-updater.ts` 会把它投影为会话消息，`session/runner/to-llm-message.ts` 将其转为 `role: "user"` 的模型输入，但 UI 渲染层不显示 |
| TUI 插件插槽卡片 | 渲染 | 不加载 | 否 | Desktop 为 Electron/Chrome 渲染器，不加载 OpenTUI 插件入口 |

其他要点：

- `session.command`（`POST /api/session/:sessionID/command`）对 execute 型命令返回 NoContent，server **不会**自动插入任何可见消息；结果可见性完全由插件自行负责。
- Desktop 的连接对话框会**过滤掉已有 credential 的 integration**（`packages/app` 前端产物中 `!e.connections.some(e => e.type === "credential")`）。插件连接成功后 `litellm` 不再出现在 connect 列表中，这是预期行为，不代表插件未安装。

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

## 2026-09-25：对话反馈通道（`session.prompt`）投递行为实测（任务 1.1 go/no-go）

**方法**：隔离 XDG 四目录 + `config/plugins` 指向本地探测插件目录（`file:///...plugin/`），
配置 `providers.stub`（`@opencode/ai/providers/openai-compatible`）指向本地假模型服务，
以 `opencode serve` 起私有服务，通过 `@opencode/client/promise` 创建会话并调用
`session.command()`。未读取用户凭据、未连接 LiteLLM。

**宿主要点**：`server.info()` 就绪后插件注册仍在进行，必须轮询 `command.list` 直到插件命令出现
（本次最多等待约 20 秒）。本地插件目录（`config/opencode/plugins/`）在本机未生效；
`config.plugins` 中的目录 `file://` URL 生效。

**结果（2.0.15 与 2.0.16 一致）**：

| 探测 | 命令耗时 | 消息列表新增 | 会话上下文可见（模型输入） | inbox |
|---|---:|---|---|---|
| `prompt`（未指定 delivery） | 17ms / 19ms | 1 条 `type: user`，文本即探测标记 | 是 | 空 |
| `prompt` + `delivery: queue` | 11ms / 10ms | 同上 | 是 | 空 |
| `prompt` + `delivery: steer` | 11ms / 10ms | 同上 | 是 | 空 |
| `synthetic({ resume: false })` | 14ms / 9ms | **0 条** | 否 | 1 条 `type: synthetic` |

**忙碌会话（模型请求长时间未返回，本地慢速 stub）**：

- 命令仍在 55ms / 42ms 内完成，`prompt` 调用在 46ms 内 resolve，未拒绝、未阻塞。
- 反馈消息进入 inbox（`type: user`、`delivery: steer`），当时尚未出现在消息列表；
  当前回合结束后可被消费显示，不丢失。
- 命令不等待模型回复。

**结论：go**。`ctx.session.prompt` 在命令 execute 上下文中可用、快速返回、消息即时成为会话内可见
user 消息（`role: user` 渲染路径，TUI 与 app 时间线均渲染该角色），且对模型上下文可见；
delivery 三态在空闲会话无可见差异，忙碌会话不阻塞命令。因此选定：**空闲与忙碌均使用默认投递
（不显式指定 delivery）**，由宿主 inbox 语义决定排队；命令侧不等待模型回复，返回时机为
`prompt` resolve 之后，失败按静默降级处理。
