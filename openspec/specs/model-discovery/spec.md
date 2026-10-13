# model-discovery Specification

## Purpose
定义插件从 LiteLLM 发现哪些模型、过滤哪些模型，以及如何为每个模型填充名称、能力、上下文与输出上限、推理档位；规定 LiteLLM 与 models.dev 两个数据源的优先级。

## Requirements

### Requirement: 以真实部署作为模型清单
插件 SHALL 以 LiteLLM `/v1/model/info` 返回的部署作为模型清单来源，按 `model_name` 聚合为模型。插件 MUST NOT 注册仅出现在 `/v1/models` 或 `/model_group/info`、但在 `/v1/model/info` 中没有任何部署的模型名。

#### Scenario: 团队白名单中残留已删除的模型名
- **WHEN** `/v1/models` 返回 `gpt-5.5`，但 `/v1/model/info` 中不存在 `model_name` 为 `gpt-5.5` 的部署
- **THEN** `gpt-5.5` 不被注册

### Requirement: 只注册对话模型
插件 SHALL 只注册 `mode` 为 `chat`、`responses` 或未设置 `mode` 的部署；`mode` 为其他任何值（如 `embedding`、`image_generation`、`audio_transcription`、`audio_speech`、`moderation`、`rerank`、`search`、`completion`、`ocr`、`realtime`）的部署 MUST NOT 被注册。`mode` 未设置时，模型名匹配图像模型特征（以 `gpt-image` 或 `dall-e` 开头，或包含 `image`）的部署 MUST NOT 被注册；`mode` 已设置时不按名字排除。

#### Scenario: 过滤非对话模型
- **WHEN** 发现结果中包含 `mode: embedding` 的 `text-embedding-v4` 与 `mode: image_generation` 的 `gpt-image-2`
- **THEN** 两者都不出现在模型选择器中

#### Scenario: mode 缺失的图像模型
- **WHEN** 某部署未设置 `mode`，模型名为 `dall-e-3`
- **THEN** 该部署不被注册

#### Scenario: mode 缺失的普通模型
- **WHEN** 某部署未设置 `mode`，模型名为 `qwen3.7-plus`
- **THEN** 该部署按对话模型注册

### Requirement: 空结果与异常数据
LiteLLM 请求成功但过滤后没有任何对话模型时，插件 SHALL 注册空的模型清单（撤下之前的模型），不得当作失败而保留上次结果。单个部署字段缺失或类型异常时，插件 SHALL 把该字段按“未提供”处理；部署缺少 `model_name` 时 SHALL 跳过该部署；不得因单个部署异常导致整次发现失败。

#### Scenario: 对话模型全部被删除
- **WHEN** 上次注册了 5 个模型，本次 `/v1/model/info` 成功返回，但只剩 embedding 部署
- **THEN** LiteLLM provider 下不再有任何模型

#### Scenario: 单个部署数据异常
- **WHEN** 某部署的 `max_input_tokens` 为字符串 `"abc"`，其他部署正常
- **THEN** 其他部署照常注册，该部署的上下文上限按回退规则确定

### Requirement: models.dev catalog 来源、形状与 modelsDevUrl 语义

OpenCode SHALL 继续从 `https://models.dev/catalog.json`（或现有合法 `modelsDevUrl` 镜像）读取同一 catalog snapshot，并保留 60 秒超时、60 秒失败退避、失败降级为空对象和 Core 形状校验。成功 catalog SHALL 由本地内存 cache 保留，不再按固定 6 小时 TTL 过期；最新网络 catalog 只由新增模型的本地匹配未命中驱动。

#### Scenario: 默认拉取 catalog 快照

- **WHEN** 扩展首次发现至少一个需要元数据匹配的模型且未配置 `modelsDevUrl`
- **THEN** 请求 `https://models.dev/catalog.json`，成功后复用本地快照，不请求 `api.json`

#### Scenario: provider-only 镜像降级不断

- **WHEN** `modelsDevUrl` 指向 provider-only 镜像
- **THEN** Core 不做 canonical 解析，LiteLLM 完整者仍发布，其余 withheld + 有效 LKG 可恢复，诊断提示改用 catalog 形状

#### Scenario: 模型列表不变

- **WHEN** LiteLLM 成功返回的可注册 `model_name` 集合与上次成功发现相同
- **THEN** OpenCode 复用 ProviderSnapshot 和注册视图，不重新执行 models.dev 匹配，也不请求 models.dev

#### Scenario: 新增模型本地命中

- **WHEN** LiteLLM 集合新增模型且本地 catalog 有该模型的可选记录
- **THEN** 只处理新增模型并复用本地 catalog，不请求最新 catalog

#### Scenario: 新增模型本地未命中

- **WHEN** LiteLLM 集合新增模型且本地 catalog 没有该模型的可选记录
- **THEN** 请求最新 catalog，并只用最新结果处理新增模型

#### Scenario: 仅删除模型

- **WHEN** LiteLLM 成功集合只删除已有模型而没有新增模型
- **THEN** 撤销被删除模型的注册，未变化模型保持不变，且不请求 models.dev

#### Scenario: 同名内部路由变化

- **WHEN** `model_name` 不变但 route、`base_model` 或 deployment ID 变化
- **THEN** 已注册配置保持不变，不触发元数据匹配或 models.dev 请求

### Requirement: 消费 Core 整记录配置
OpenCode SHALL 仅消费Core以model_name按官方 → OpenCode → OpenRouter整记录生成的配置；MUST NOT 复制模型匹配、拼字段、取LL交集/最高价或要求内部身份及serving proof。base_model/route/deployment ID不同不新增发布阻断；原有协议/default/mixed-fallback/override不变。OpenCode保留Core tools、input/output与context/input/output；SDK默认值不得扩大能力。

#### Scenario: [T01] 完整16项
- **WHEN** Core返回冻结16模型配置
- **THEN** 逐字段消费其记录与能力，保留model_name请求ID。

#### Scenario: [T08] 内部信息变化
- **WHEN** 同model_name内部route/base_model变化
- **THEN** 不额外核验或撤下；调用协议仍消费Core现有选择。

#### Scenario: [T10] 明确能力值
- **WHEN** 选中记录给出false、text-only、[]或toggle
- **THEN** 不从低优先来源或宿主默认添加能力；遵守实际宿主表达边界。

#### Scenario: [T03] 官方记录不存在
- **WHEN** Core选中OpenCode或OpenRouter整记录
- **THEN** 直接消费，不要求用户补provider声明。

### Requirement: 精确宿主推理选项映射
OpenCode SHALL 独立保留Core reasoning支持与variants，只映射选中记录的reasoning_options，不从GPT模板、家族或LL标志生成。variants/settings映射到Model.Info；支持无effort保持空variants，不让默认值新增档位。本轮不扩展Messages预算推导，保留已有兼容映射。

#### Scenario: [T13] GPT各自档位
- **WHEN** luna有none而astra/6.1-sol无none
- **THEN** 分别映射各自列表。

#### Scenario: [T14] 支持无档位
- **WHEN** Core reasoning=true且options=[]或toggle
- **THEN** 保持支持而无额外effort档位。

#### Scenario: [T33] 真实宿主请求
- **WHEN** 真实宿主注册、选择档位并调用
- **THEN** picker与请求参数符合记录；无effort模型不泄漏默认effort，不支持推理用例无推理参数。

### Requirement: 原始模型名与可选参考价
OpenCode SHALL 保留model_name原样作为ID、请求名和显示名；只消费Core所选记录参考价或0。MUST NOT 跨provider补价、优先LL价格、把0宣称免费或按价格截断限制。价格不影响注册、能力与LKG。

#### Scenario: [T16] 价格缺失或错误
- **WHEN** 所选记录价格归零而其他provider有价格
- **THEN** 使用0且仍正常注册，限制/档位不变。

#### Scenario: [T17] 原272k价格阶梯
- **WHEN** Core context为1050000
- **THEN** 宿主不再截断；旧contextTierCap忽略。

### Requirement: Recover transient metadata-withheld models on an unchanged set

OpenCode SHALL reuse Core's incremental recovery candidates. When a prior successful LiteLLM response has a model withheld as `metadata-unavailable` because Core diagnostics reported a degraded models.dev catalog, a later network refresh MAY process that model again even when the `model_name` set is unchanged. Normally registered ProviderSnapshot models MUST remain reused. Stable unmatched, invalid-metadata and discovered-incomplete results MUST NOT cause additional metadata requests on an unchanged set.

#### Scenario: Temporary catalog failure recovers without a model-set change

- **WHEN** a newly added model was withheld as `metadata-unavailable` during a degraded catalog request and a later catalog request succeeds while LiteLLM returns the same `model_name` set
- **THEN** OpenCode reprocesses the withheld model through Core, registers it if configured, and retains existing normally registered models without reprocessing them

#### Scenario: Stable unmatched identity does not retry

- **WHEN** a complete catalog has no matching record for a model and the catalog later gains a matching record while the LiteLLM `model_name` set remains unchanged
- **THEN** OpenCode reuses the prior unmatched result and does not request or reprocess metadata until the model-name set changes
