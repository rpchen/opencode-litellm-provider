## Context

动机见 proposal.md。宿主接口的调研依据见 `docs/research/opencode-v2-plugin-api.md`：`@opencode/plugin@2.0.15` 的类型定义，以及上游 `anomalyco/opencode` `beta` 分支的实现源码。对设计有约束的宿主事实如下：

- 插件以 Promise API（`Plugin.define({ id, setup(ctx) })`）编写。transform 回调是**同步**的：异步发现必须在回调外完成，结果缓存起来，由回调写入，再调用 `reload()` 让宿主重新执行 transform。上游官方的 `lmstudio` 插件就是这个模式：轮询 → 结果哈希比较 → 有变化才 reload。
- 模型调用时，宿主把 `provider/model.settings`、凭据 `metadata`、key 表单答案 `configuration` 合并为 provider 包的 settings，并注入 `apiKey = credential.key`（`model-resolver.ts`）。
- `Provider.Info.integrationID` 把 provider 绑定到一个 integration。只有该 integration 有活动连接时，provider 才可用。
- provider 记录可以带 `sourceConnection`。当活动连接与它不一致时，宿主会自动隐藏这个 provider（`provider.ts` 的 snapshot），用来防止“旧账号发现的模型 + 新账号凭据”混用。
- `Model.Info.package` 可以覆盖 `Provider.Info.package`，所以同一个 provider 下的不同模型可以使用不同的协议包。provider 级 `settings` 会与模型级 `settings` 合并（`model.ts` 的 `mergeOverlay`）。
- `sourceConnection` 只能通过 `ProviderEditor.add({ info, models, sourceConnection })` 设置；`update` / `models.update` 不能设置它。`add` 写入的是完整记录，不会用 `Model.Info.default` 补默认值。
- 原生协议包 `@opencode/ai/providers/*` 的 settings 都接受 `baseURL`（需带 `/v1`，端点为 `baseURL + /chat/completions | /responses | /messages`）与 `apiKey`。Chat / Responses 以 `Authorization: Bearer` 发送 Key，Messages 类包以 `x-api-key` 发送。
- 宿主 `provider.ts` 的内置包表（`builtins`）包含 `openai-compatible`、`openai/responses`、`anthropic` 等，**不包含** `openai-compatible-responses` 与 `anthropic-compatible`；非内置的 `@opencode/ai/*` 走动态 `import()`，打包后的宿主能否加载未经证实。
- 连接变更事件：Promise 版 `ctx.event.subscribe()` 透传宿主全部事件，其中 `credential.switched`（`data: { integrationID, credentialID | null }`）在创建、激活、删除活动凭据时发出，`credential.updated` 在凭据增删改时发出。

实测过的 LiteLLM 事实（v1.97.0）：
- `/v1/model/info` 按用户 Key 的权限过滤，返回真实部署。
- `/v1/models` 与 `/model_group/info` 会把团队白名单中的名字原样列出，不校验部署是否存在。
- `model_info.supported_endpoints` 是官方的端点能力字段，但覆盖率低；实测抓取中所有部署都没有这个字段，协议实际由 `mode` 决定。
- 阶梯价有两种表达：`*_above_<N>k_tokens` 字段，以及 `tiered_pricing` 数组（每档带 `range: [起点, 终点]`，DashScope / Qwen 使用）。
- 部署的 `litellm_params` 中含上游 `api_base`、`litellm_credential_name`、`tags`，`model_info` 中含 `access_via_team_ids`、`access_groups`、部署 `id`，属于敏感或内部信息。

## Goals / Non-Goals

**Goals:**
- 适用于任意 LiteLLM 部署的零配置接入：地址 + Key。
- 发现逻辑写成与宿主无关的纯函数（输入 LiteLLM / models.dev 响应，输出模型描述），可以用固定样本完整做单元测试。
- 对宿主 API 的调用集中在一个薄适配层，宿主 API 变化时只改这一层。

**Non-Goals:**
- 不提供 TUI 或命令式的“立即刷新”按钮（后续变更再加）。
- 不做 LiteLLM 管理功能（建模型、改额度等）。
- 不打包任何 AI SDK，也不自建 SDK 实例。
- 不支持 OAuth / SSO 登录 LiteLLM，只支持 API Key。
- 不做模型可用性探测（不发试探请求）。

## Decisions

### D1. 模块划分：纯核心 + 宿主适配层

```
src/
  index.ts            插件入口：读取 options，创建发现循环，返回 cleanup
  options.ts          可选插件配置的解析与校验（轮询间隔、协议覆盖、阶梯截断开关）
  core/
    litellm.ts        LiteLLM 响应类型、地址规范化、部署聚合
    protocol.ts       协议判定（纯函数）
    capabilities.ts   能力 / 上限 / 模态 / 价格映射、多部署合并、阶梯截断
    modelsdev.ts      models.dev 记录选择、家族 → 原厂映射、variants 生成
    build.ts          组合以上模块：deployments + catalog + options → ModelSpec[]
  host/
    sync.ts           发现循环：连接读取、轮询、缓存、指纹比较、reload
    register.ts       ModelSpec[] → ProviderEditor 写入；integration 注册
  net/
    fetch.ts          带超时的 HTTP 获取、错误分类、Key 脱敏
```

`core/` 不引用 `@opencode/plugin`，只输出自定义的 `ModelSpec`；`host/register.ts` 负责把它映射到 `Model.Info`。
- 备选：直接在 transform 回调里边请求边写入。放弃原因：回调是同步的，做不到；而且无法脱离宿主测试。

### D2. 连接：key 方式 + 表单 `baseURL`

integration 与 provider 的 id 固定为 `litellm`，显示名固定为 `LiteLLM`；地址完全来自用户在 `/connect` 中的填写，插件不内置任何地址。`ctx.integration.transform` 中执行：
- `update("litellm", i => i.name = "LiteLLM")`；
- `method.update({ integrationID: "litellm", method: { type: "key", label: "API Key", form: [{ key: "baseURL", type: "string", format: "uri", required: true, title: "LiteLLM 地址", placeholder: "http://litellm.example:4000" }] } })`。

发现时用 `ctx.integration.connection.active("litellm")` 取得连接，再用 `resolve` 取得 `{ key, configuration.baseURL }`。
调用时依赖宿主投影：`configuration.baseURL` 会合并进 settings 的 `baseURL`，`credential.key` 会成为 `apiKey`。

**地址规范化与投影冲突**：用户可能填写 `.../v1` 或根地址。而原生包需要的 `baseURL` 是带 `/v1` 的地址，投影又会**原样**覆盖 settings。所以插件在注册模型时，要**显式**把规范化后的 `baseURL = <根地址>/v1` 写到 `model.settings`。
实施的第一步 spike 必须验证合并优先级：宿主的合并顺序是 `settings ← credential.metadata ← configuration`，也就是 configuration 最后覆盖、优先级最高。如果确实如此，用户填的原始地址会覆盖插件写入的规范化地址。
- 方案 A（首选）：表单字段 key 不叫 `baseURL`，改叫 `url`，避免投影覆盖；插件自己把规范化结果写进 `settings.baseURL`。这样行为确定，也不依赖投影这个内部实现。
- 方案 B：仍叫 `baseURL`，并要求用户填写带 `/v1` 的完整地址。放弃原因：用户容易填错。

**决定采用方案 A**（字段 key 为 `url`）。这同时消除了 proposal 中“依赖投影内部行为”的风险：插件只依赖投影注入 `apiKey`，这是 key 认证方式的基础语义。

### D3. Provider 与模型写入

每次 transform 用 `ProviderEditor.add` **整体替换** provider 记录：
- `info`：`id = "litellm"`，`integrationID = "litellm"`，`name = "LiteLLM"`，`activation = "auto"`，`package` = Chat 协议包（缺省值），`settings.baseURL = <根地址>/v1`（写在 provider 级，模型继承，不在每个模型上重复）。
- `models`：本次发现的全部模型。因为是整体替换，已消失的模型自然被移除，不需要逐个删除。
- `sourceConnection` = 本次发现所用的连接，由宿主负责在换号或断开后隐藏这份结果（对应 spec“切换连接时不混用旧结果”）。

`add` 不补默认值，所以每个模型都要构造**完整的** `Model.Info`：`id`、`modelID`、`providerID`、`name`（= `model_name`）、`package`（按协议）、`capabilities`、`variants`、`time.released`（models.dev `release_date`，缺失为 0）、`cost`、`status = "active"`、`enabled = true`、`limit`。`core/` 输出的 `ModelSpec` 在 `host/register.ts` 中以 `Model.Info.default` 为底合成，避免漏字段。
没有活动连接或首次发现未成功时，transform 不写入 provider 记录。

**协议包选择（待 spike 1.1 定案）：**

| 协议 | 首选（A） | 备选（B，内置包表中存在） |
|---|---|---|
| Chat | `@opencode/ai/providers/openai-compatible`（内置） | 同左 |
| Responses | `@opencode/ai/providers/openai-compatible-responses`（非内置） | `@opencode/ai/providers/openai/responses` |
| Messages | `@opencode/ai/providers/anthropic-compatible`（非内置） | `@opencode/ai/providers/anthropic` |

A 是面向“兼容网关”的通用包，请求体最贴近 LiteLLM 的期望；但两个包不在宿主内置表中，打包后的宿主可能无法动态加载。spike 1.1 先验证 A；A 不可加载时改用 B，并比较 B 对 LiteLLM 的请求体差异（B 是面向官方服务的包，可能附带 OpenAI / Anthropic 专属默认项）。包名集中在 `core/protocol.ts` 的映射表中，切换只改一处。
- 备选：按协议拆成三个 provider（与旧脚本一致）。放弃原因：用户需要连接三次或理解三个入口；而 `Model.Info.package` 本来就支持按模型选择协议。

### D4. 协议判定与 variants 写入字段

判定规则见 specs/protocol-routing。实现要点：
- `supported_endpoints` 只识别 `/v1/responses` 与 `/v1/chat/completions` 两个值（也接受不带 `/v1` 前缀的写法），其他值忽略。
- variants 写入 `Variant.settings`。宿主把它与模型 settings 合并后作为原生包的 providerOptions，由协议层翻译成请求体字段。所以这里要写的是**原生包读取的选项键**，不是请求体里的 wire 字段；写错的键会被 Schema 静默丢弃，档位不报错也不生效。
  - Chat 与 Responses 协议：`{ reasoningEffort: v }`。协议层分别翻译为请求体的 `reasoning_effort` 与 `reasoning.effort`（`protocols/openai-chat.js`、`protocols/open-responses.js` 的 `lowerOptions`）。
  - Messages 协议：effort 类档位写 `{ effort: v }`；budget 类档位写 `{ thinking: { type: "enabled", budgetTokens: n } }`（`protocols/anthropic-messages.js` 的 Options）。

  tasks 1.4 用真实请求抓包，确认请求体中出现对应的 wire 字段。映射表集中在 `core/modelsdev.ts`，改键名只动一处，不影响 spec（spec 只规定档位集合与语义）。

### D5. 家族 → 原厂识别

采用有序的前缀 / 正则表，基于模型名匹配（去掉路由前缀后小写），每项给出原厂及备选（完整继承基线家族表）：

| 模式 | 原厂 → 备选 |
|---|---|
| `gpt-`、`o\d`、`codex` | openai |
| `claude-` | anthropic |
| `gemini-` | google |
| `grok-` | xai |
| `glm-` | zai → zhipuai |
| `deepseek-` | deepseek |
| `kimi-` | moonshotai → moonshotai-cn |
| `mimo-` | xiaomi |
| `minimax-` | minimax → minimax-cn |
| `qwen` | alibaba → alibaba-cn |

部署 `model_info.models_dev_provider` 显式给出时直接作为原厂（与基线一致）。
候选 id 依次为 `base_model` → 去掉路由前缀的 `litellm_params.model` → `model_name`，与 models.dev 的 id 做大小写不敏感比较（models.dev 中 MiniMax 原厂 id 为 `MiniMax-M3` 这种大小写）。对每个候选 id 依次尝试“原厂 / 备选 → opencode → 唯一 provider”，第一个命中即停。
家族识别本身也按同一候选 id 顺序，取第一个能匹配家族表的候选。
- 备选：使用 LiteLLM 的 `litellm_provider`。放弃原因：实测中它大多是 `openai`（经 OpenAI 兼容网关转发），反映的不是模型原厂。

### D6. 阶梯截断

阶梯点取以下两个来源中的最小值：
1. 部署 `model_info` 中匹配 `^input_cost_per_token_above_(\d+)k_tokens$` 且值非零的字段，阶梯点 = N×1000；
2. `model_info.tiered_pricing` 数组中各档 `range[0]` 大于 0 的值。

`limit.context = min(max_input_tokens, 阶梯点)`，`limit.input` 同步截断。
只看 input 字段：阶梯由输入长度触发，output / cache 的阶梯字段只会跟 input 同时出现，不会单独出现。实测样本中 GPT 系列阶梯点为 272k，minimax-m3 为 512k。

### D7. 刷新、指纹与缓存

- **发现循环**：启动时执行一次 → 之后每隔 `pollInterval` 执行一次（默认 300s，下限 30s）。
- **连接变更**：通过 `ctx.event.subscribe()` 订阅 `credential.switched`（按 `data.integrationID === "litellm"` 过滤）与 `credential.updated`；收到后调用 `connection.active("litellm")` 复核连接是否变化（比较连接 key），变化则立即发现并重置计时，无连接则停止轮询。spike 1.5 只需确认事件到达与 `connection.active` 更新的先后顺序。
- **指纹**：对 `ModelSpec[]` 做稳定序列化（键排序）后比较字符串，不同才写入缓存并调用 `ctx.provider.reload()`。
- **并发**：同时最多只有一个发现在进行，新触发的发现合并到正在进行的那次。
- **models.dev**：进程内缓存 6 小时。获取失败时按 60 秒退避，下次刷新时重试。插件不在磁盘上写任何缓存。
- **超时**：LiteLLM 请求 15 秒；models.dev 的 `api.json` 约 5 MB，请求超时设为 60 秒。

### D8. 失败分类（对应 specs/change-sync）

| 情况 | 行为 |
|---|---|
| 网络错误 / 超时 / 429 / 5xx / 响应无法解析 | 保留上次结果，记录 warn，等下个周期 |
| 3xx | 不跟随重定向（避免把 Key 带到别的主机），按网络错误处理并提示检查地址 |
| 401 / 403 | 清空结果并 reload，记录 error“Key 无效或无权限” |
| 404 | 先回退请求 `/model/info`（不带 `/v1`）；仍为 404 则清空结果并报错，提示检查地址或 LiteLLM 版本 |
| 成功但过滤后没有对话模型 | 注册空清单（撤下旧模型），不视为失败 |
| 单个部署字段异常 | 该字段按“未提供”处理，缺 `model_name` 的部署跳过，不影响其他部署 |
| 地址不是 http / https | 不发请求，不注册模型，记录 error |
| models.dev 失败 | 按“无记录”继续构建 |

所有日志通过 `net/fetch.ts` 统一脱敏：将 Key 替换为 `sk-***`，并去掉 URL 中的用户信息。任何情况下都不把 LiteLLM 或 models.dev 的响应体写入日志。

### D9. 插件配置（`ctx.options`）

```jsonc
{
  "plugins": [{
    "package": "opencode-litellm-provider",
    "options": {
      "pollInterval": 300,                                   // 秒
      "contextTierCap": true,                                // 阶梯截断
      "protocolOverrides": { "glm-5.3": "chat" }
    }
  }]
}
```

所有配置项都是可选的，不配置即使用默认值。不合法的配置项记录 warn，并回退到默认值，不阻止插件加载。

### 与 opencode-litellm-config-sync 行为基线的差异

| 差异 | 理由 |
|---|---|
| 发现使用用户自己的 Key，不再使用单独的发现 Key | 实测两把 Key 的可见模型集合不同；用用户 Key 能保证列出的正是可调用的模型 |
| 模型清单只取 `/v1/model/info` 中的真实部署 | `/v1/models` 会列出团队白名单中已无部署的残留名字 |
| 协议按 `supported_endpoints` > `mode` 判定，不再“GPT 即 Responses” | 与 LiteLLM 管理员的声明一致，对任意部署通用；用户已确认。不对模型发试探请求，判错时用 `protocolOverrides` 兜底 |
| 单个 provider、按模型选择协议包，取代三个 provider 拆分 | v2 支持模型级 `package`，用户只需连接一次 |
| 使用宿主原生包 `@opencode/ai/providers/*`，不再使用 `@ai-sdk/*` | v2 宿主自带，与上游官方插件（lmstudio 等）一致；具体用哪几个包由 spike 1.1 定（D3） |
| 上下文窗口按阶梯价字段截断，不再读取 Codex `models_cache.json` | 通用插件不能假设本地装有 Codex；目的相同，都是避开高价区间；用户已确认 |
| 推理档位来源顺序为：原厂 → OpenCode Zen → 唯一 provider（与基线一致），但写入键按原生包选项名调整 | 包由 `@ai-sdk/*` 换为原生包，选项键不同 |
| Messages 判定增加 `litellm_provider` / `custom_llm_provider` 与 Claude 家族 | 基线只看 `anthropic/` 前缀，会漏判 DB 方式配置、以及经 Bedrock / Vertex 部署的 Claude |
| budget 档位：记录未声明最大预算时仍生成 `high`（16000） | 基线在没有最大值时不生成任何 budget 档位；新规则让这类 Claude 模型至少有一个可用的思考档位。有最大值时与基线一致：`high = min(16000, max)` |
| 显示名原样使用 `model_name` | 基线把名字格式化为 title-case；用户决定原样显示，与调用名一致 |
| models.dev 匹配：候选 id `base_model` → 去前缀路由名 → `model_name`，大小写不敏感 | 与基线一致（基线同样小写比较并包含去前缀路由名）；显式列出以免实现时遗漏 |
| 家族表、`-cn` 备选、`models_dev_provider` 覆盖、DeepSeek/Kimi/MiMo/Qwen 模态信任名单、mode 缺失时按名字排除图像模型 | 与基线一致，全部保留（用户已确认） |

## Risks / Trade-offs

- [v2 插件 API 在 2.0.x 期间变化] → 宿主调用集中在 `host/`；`peerDependencies` 固定 `>=2.0.15 <2.1`（tasks 2.4）；每次升级宿主时跑 spike 清单（tasks 第 1 组）。
- [两个首选协议包不在宿主内置包表中，打包后的宿主无法加载] → spike 1.1 作为前置门槛最先验证；不可加载时改用内置的 `openai/responses` / `anthropic`（D3 备选 B）。
- [LiteLLM 不接受 Messages 协议的 `x-api-key` 头] → spike 1.1 验证；插件不能把 Key 写进 `headers` 改用 Bearer（会持久化泄露）。若不通过，Messages 协议不可用，Claude 家族改走 Chat，并同步修改 spec。
- [原生包的推理选项键与假设不一致，导致档位静默不生效] → tasks 1.4 逐协议抓包验证；映射表集中在一处。
- [实测环境没有 `supported_endpoints`，协议完全由 `mode` 决定；经 `openai/` 网关转发的非 OpenAI 模型被标为 `responses` 时，LiteLLM 的 Responses 桥接未必可用] → 按用户确认的规则执行，不发试探请求；遇到个别模型不可用时用 `protocolOverrides` 覆盖。
- [连接变更事件与 `connection.active` 更新存在先后顺序问题] → 收到事件后以 `connection.active` 的结果为准；即使事件漏收，轮询也会在一个间隔内发现（换号瞬间旧模型已由 `sourceConnection` 隐藏，不会误用旧凭据）。
- [表单答案 `url` 随 configuration 进入原生包选项] → 目前被 Schema 静默丢弃；spike 1.2 确认请求体中不出现 `url`。
- [阶梯截断让用户无法使用超过阶梯点的长上下文] → 默认开启是用户的明确选择；可以关闭。
- [models.dev 模型 id 与 LiteLLM 模型名不一致，匹配不到] → 优先使用 `base_model`；匹配不到时只是缺少档位和补缺字段，不影响可用性。
- [大量模型时 transform 全量重写的开销] → 只在指纹变化时 reload；模型数在百级以内，可以接受。

## Migration Plan

1. 安装：在 opencode v2 配置的 `plugins` 中加入 `opencode-litellm-provider`（未发布到 npm 前，用 `file://` 指向本地构建产物）。
2. 在 OpenCode 连接界面连接 LiteLLM：填写地址与 Key。
3. 确认新 provider 下的模型正常后，从 `~/.config/opencode/opencode.jsonc` 中删除 `litellm`、`litellm-openai`、`litellm-anthropic` 三个静态 provider 块，停止使用 `opencode-litellm-config-sync`。
4. 回滚：从 `plugins` 中移除插件，恢复备份的静态 provider 块即可。插件不修改任何配置文件，所以无需清理。

## Open Questions

- npm 包的发布名与发布时机（`opencode-litellm-provider` 是否已被占用），不影响本变更的实现，发布前确认即可。
