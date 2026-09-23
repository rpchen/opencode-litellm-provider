## Why

目前 OpenCode 连接 LiteLLM 依赖手工运行 `opencode-litellm-config-sync` 生成静态 provider 配置：LiteLLM 端每次增删模型、调整元数据都要人工重跑，而且脚本用一把发现 key 列模型、写入的却是另一把用户 key，两把 key 的可见模型集合可能不同。OpenCode v2 已提供 provider / integration 插件接口，可以把“填地址 + 填 Key → 自动发现 → 跟随变更”做成通用插件，适用于任意 LiteLLM 部署，不绑定特定服务。

## What Changes

- 新增 OpenCode v2 插件 `opencode-litellm-provider`（npm 包），注册名为 “LiteLLM” 的 integration：用户在 OpenCode 的连接界面填写 **LiteLLM 地址** 与 **API Key** 即完成接入；支持多个 LiteLLM 实例并存（每个实例独立命名）。
- 使用**用户自己的 API Key** 调用 LiteLLM `/v1/model/info` 发现该 Key 实际可调用的模型部署；不注册缺少元数据的模型名（例如团队白名单中残留、但已无部署的模型名），也不注册 embedding、图像生成等非对话模型。
- 为每个模型自动判定原生协议：Anthropic Messages / OpenAI Responses / OpenAI Chat Completions。判定依据是 LiteLLM 的 `supported_endpoints`、`mode` 和上游 provider；声明了多个协议时取 responses 优先于 chat；支持用户按模型覆盖。
- 自动填充模型能力：上下文 / 输入 / 输出上限、输入输出模态、工具调用、推理。LiteLLM 有的值优先使用，models.dev 只补缺。
- 按阶梯价字段（如 `input_cost_per_token_above_272k_tokens`）推算价格阶梯点，把上下文窗口限制在首个阶梯点以内，避免进入高价区间；可关闭。**不再**依赖本地 Codex `models_cache.json`。
- 推理档位（variants）来源：优先取 models.dev 中模型原厂的记录，其次取 OpenCode Zen（models.dev id `opencode`）的记录，都没有则不生成。**不使用** LiteLLM 的 `supports_*_reasoning_effort` 字段。
- 自动跟随 LiteLLM 端变更：定时轮询 + 连接变更时立即刷新，内容无变化则不触发重载；LiteLLM 或 models.dev 不可达时保留上次成功的结果。
- 所有模型挂在同一个 LiteLLM provider 下，每个模型各自使用对应的协议包；原先拆成 `litellm` / `litellm-openai` / `litellm-anthropic` 三个 provider 的方式不再需要。

## Capabilities

### New Capabilities

- `litellm-connection`：用户如何把一个 LiteLLM 实例接入 OpenCode（地址、Key、多实例、凭据的使用范围与保密）。
- `model-discovery`：从 LiteLLM 发现哪些模型、如何过滤、如何填充能力与上限（含阶梯价上下文截断），以及 models.dev 补缺规则与推理档位来源。
- `protocol-routing`：每个模型使用哪种调用协议的判定规则与用户覆盖。
- `change-sync`：发现结果的刷新触发、变更检测、失败降级与缓存。

### Modified Capabilities

（无，项目首个变更）

## Impact

- **新代码**：`src/` 下的插件实现与 `test/` 下的单元测试；`test/fixtures/` 新增脱敏后的 LiteLLM `/v1/model/info` 与 models.dev 响应样本。
- **运行时依赖**：仅 `@opencode/plugin`（peer，>= 2.0.15）。协议实现使用宿主自带的原生包 `@opencode/ai/providers/{openai-compatible, openai-compatible-responses, anthropic-compatible}`，插件本身不打包任何 SDK。
- **依赖的 OpenCode v2 插件 API**（Promise 版，`@opencode/plugin`）：
  - `ctx.integration.transform`：注册 key 认证方式及表单字段（`baseURL`），并注册 integration。
  - `ctx.integration.connection.active / resolve`：读取当前连接的 Key 与表单答案，用于发现请求。
  - `ctx.provider.transform`：通过 `ProviderEditor.update` / `models.update` / `models.remove` 注册 provider 与模型。
  - `ctx.provider.reload`、`ctx.integration.reload`：发现结果变化后触发重载。
  - `ctx.event`：订阅连接变更事件。
  - `ctx.options`：读取插件配置（轮询间隔、协议覆盖、阶梯截断开关）。
- **API 风险**：
  - v2 插件 API 来自上游 `anomalyco/opencode` 的 `beta` 分支，处于 2.0.x 快速迭代期，没有稳定性承诺；本变更把宿主版本下限固定为 2.0.15，并在适配层集中封装对宿主 API 的调用。
  - 凭据投影行为（表单答案 `configuration` 合并进模型 `settings`）是宿主内部实现（`model-resolver.ts`），不在公开类型中声明，将来可能变化；设计中保留插件显式写入 `settings.baseURL` 的后备路径。
  - 原生协议包路径（`@opencode/ai/providers/*`）属于宿主内置实现，不是公开的插件契约。
- **对用户的影响**：已用 `opencode-litellm-config-sync` 生成静态配置的用户，迁移时需要从 opencode 配置中删除 `litellm*` 这几个 provider 块，改用本插件（见 design.md 的 Migration Plan）。
