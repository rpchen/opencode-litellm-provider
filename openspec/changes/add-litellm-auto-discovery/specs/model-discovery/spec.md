## Purpose

定义插件从 LiteLLM 发现哪些模型、过滤哪些模型，以及如何为每个模型填充名称、能力、上下文与输出上限、推理档位；规定 LiteLLM 与 models.dev 两个数据源的优先级。

## ADDED Requirements

### Requirement: 以真实部署作为模型清单
插件 SHALL 以 LiteLLM `/v1/model/info` 返回的部署作为模型清单来源，按 `model_name` 聚合为模型。插件 MUST NOT 注册仅出现在 `/v1/models` 或 `/model_group/info`、但在 `/v1/model/info` 中没有任何部署的模型名。

#### Scenario: 团队白名单中残留已删除的模型名
- **WHEN** `/v1/models` 返回 `gpt-5.5`，但 `/v1/model/info` 中不存在 `model_name` 为 `gpt-5.5` 的部署
- **THEN** `gpt-5.5` 不被注册

### Requirement: 只注册对话模型
插件 SHALL 只注册 `mode` 为 `chat`、`responses` 或未设置 `mode` 的部署；`mode` 为 `embedding`、`image_generation`、`audio_transcription`、`audio_speech`、`moderation`、`rerank`、`search`、`completion` 等的部署 MUST NOT 被注册。

#### Scenario: 过滤非对话模型
- **WHEN** 发现结果中包含 `mode: embedding` 的 `text-embedding-v4` 与 `mode: image_generation` 的 `gpt-image-2`
- **THEN** 两者都不出现在模型选择器中

### Requirement: 多部署模型的能力合并
同一 `model_name` 下有多个部署时，插件 SHALL 采用保守合并：布尔能力取所有部署的交集（全部支持才视为支持），数值上限取最小值，模态取交集。

#### Scenario: 两个部署上限不同
- **WHEN** 同名模型两个部署的 `max_input_tokens` 分别为 200000 与 128000
- **THEN** 注册的上下文上限基于 128000

### Requirement: 能力字段映射与数据源优先级
插件 SHALL 按以下优先级确定每个字段：LiteLLM 部署信息中的值 > models.dev 选中记录中的值 > OpenCode 默认值。映射至少包括：
- 上下文 / 输入上限：`max_input_tokens`；输出上限：`max_output_tokens`（缺失时回退 `max_tokens`）
- 工具调用：`supports_function_calling`
- 推理：`supports_reasoning`
- 输入模态：文本恒有；`supports_vision` → 图片；`supports_pdf_input` → PDF；`supports_audio_input` → 音频；`supports_video_input` → 视频
- 输出模态：文本；`supports_audio_output` → 音频

#### Scenario: LiteLLM 缺失输出上限
- **WHEN** 某部署没有 `max_output_tokens` 与 `max_tokens`，而 models.dev 选中记录的 `limit.output` 为 65536
- **THEN** 注册的输出上限为 65536

#### Scenario: 两个来源冲突
- **WHEN** LiteLLM 给出 `supports_vision: false`，models.dev 记录的输入模态包含 image
- **THEN** 注册的输入模态不包含图片

### Requirement: models.dev 记录选择
插件 SHALL 只从一条 models.dev 记录补充一个模型的缺失字段，选择顺序为：1）模型原厂 provider 下 id 精确匹配的记录；2）OpenCode Zen（models.dev provider id `opencode`）下 id 精确匹配的记录；3）若该 id 在全部 provider 中只存在于唯一一个 provider，则取该记录。以上都不满足时 SHALL 不补充任何字段。插件 MUST NOT 跨多条记录合并字段，MUST NOT 通过去掉 `-free` 等后缀进行模糊匹配。模型原厂 SHALL 由模型名所属家族识别（如 GPT → openai、Claude → anthropic、GLM → zai、DeepSeek → deepseek、Kimi → moonshotai、MiMo → xiaomi、MiniMax → minimax、Qwen → alibaba、Gemini → google）。

#### Scenario: 原厂记录缺失时使用 Zen
- **WHEN** 模型 `kimi-k2.6` 在 models.dev 的 `moonshotai` 下不存在，但在 `opencode` 下存在
- **THEN** 使用 `opencode` 下的记录补充缺失字段

#### Scenario: 多个转售记录且无原厂与 Zen 记录
- **WHEN** 某模型 id 只存在于两个第三方 provider 下
- **THEN** 不从 models.dev 补充任何字段

### Requirement: 推理档位来源
插件 SHALL 仅依据上一条规则选中的 models.dev 记录的 `reasoning_options` 生成推理档位（variants）；插件 MUST NOT 依据 LiteLLM 的 `supports_*_reasoning_effort` 等字段生成或删减档位。生成规则：
- `type: effort` 的每个取值生成一个同名档位；OpenAI 协议（chat / responses）下写入 `reasoningEffort`，Anthropic Messages 协议下写入 `effort`。
- `type: budget_tokens` 且协议为 Anthropic Messages 时，生成 `high`（16000 tokens）与 `max`（记录声明的最大预算）两个档位；记录未声明最大值时只生成 `high`。
- `type: toggle` 不生成档位。
- 无 `reasoning_options` 或无选中记录时不生成档位；此时模型仍可以标记为支持推理（这是合法的最终状态）。

#### Scenario: effort 档位
- **WHEN** 走 responses 协议的模型 `gpt-5.5` 选中记录的 `reasoning_options` 为 `[{type: effort, values: [none, low, medium, high, xhigh]}]`
- **THEN** 注册 5 个档位 `none/low/medium/high/xhigh`，每个档位设置对应的 `reasoningEffort`

#### Scenario: 只有 toggle
- **WHEN** 选中记录的 `reasoning_options` 为 `[{type: toggle}]`，LiteLLM 给出 `supports_reasoning: true`
- **THEN** 模型标记为支持推理，且没有任何档位

### Requirement: 按价格阶梯截断上下文
插件 SHALL 从部署信息中形如 `input_cost_per_token_above_<N>k_tokens` 的非零字段推算价格阶梯点，取其中最小的 N×1000 作为首个阶梯点；存在阶梯点且小于原上下文上限时，注册的上下文上限（以及输入上限）SHALL 被限制为该阶梯点。该行为 SHALL 默认开启，并可通过插件配置关闭。插件 MUST NOT 读取本地 Codex `models_cache.json`。

#### Scenario: 272k 阶梯
- **WHEN** 部署的 `max_input_tokens` 为 1050000，且存在非零的 `input_cost_per_token_above_272k_tokens`
- **THEN** 注册的上下文上限为 272000

#### Scenario: 用户关闭截断
- **WHEN** 插件配置关闭阶梯截断
- **THEN** 同一模型注册的上下文上限为 1050000

#### Scenario: 无阶梯字段
- **WHEN** 部署没有任何 `*_above_<N>k_tokens` 字段
- **THEN** 上下文上限保持为 `max_input_tokens`

### Requirement: 显示名与价格
插件 SHALL 使用 LiteLLM 的 `model_name` 作为模型 id 与调用时的模型名；显示名优先取选中 models.dev 记录的 `name`，否则使用 `model_name`。插件 SHALL 在 LiteLLM 提供按 token 计价字段时填充每百万 token 的价格（输入、输出、缓存读、缓存写），缺失时回退到 models.dev 的价格，两者都没有时为 0。

#### Scenario: 价格换算
- **WHEN** 部署的 `input_cost_per_token` 为 2.5e-06
- **THEN** 注册的输入价格为每百万 token 2.5 美元
