## Context

动机见 proposal.md。宿主接口的调研依据见 `docs/research/opencode-v2-plugin-api.md`：`@opencode/plugin@2.0.15` 的类型定义，以及上游 `anomalyco/opencode` `beta` 分支的实现源码。对设计有约束的宿主事实如下：

- 插件以 Promise API（`Plugin.define({ id, setup(ctx) })`）编写。transform 回调是**同步**的：异步发现必须在回调外完成，结果缓存起来，由回调写入，再调用 `reload()` 让宿主重新执行 transform。上游官方的 `lmstudio` 插件就是这个模式：轮询 → 结果哈希比较 → 有变化才 reload。
- 模型调用时，宿主把 `provider/model.settings`、凭据 `metadata`、key 表单答案 `configuration` 合并为 provider 包的 settings，并注入 `apiKey = credential.key`（`model-resolver.ts`）。
- `Provider.Info.integrationID` 把 provider 绑定到一个 integration。只有该 integration 有活动连接时，provider 才可用。
- provider 记录可以带 `sourceConnection`。当活动连接与它不一致时，宿主会自动隐藏这个 provider（`provider.ts` 的 snapshot），用来防止“旧账号发现的模型 + 新账号凭据”混用。
- `Model.Info.package` 可以覆盖 `Provider.Info.package`，所以同一个 provider 下的不同模型可以使用不同的协议包。
- 宿主内置原生协议包：`@opencode/ai/providers/openai-compatible`（Chat）、`openai-compatible-responses`（Responses）、`anthropic-compatible`（Messages）。三者的 settings 都接受 `baseURL` 与 `apiKey`。

实测过的 LiteLLM 事实（v1.97.0）：
- `/v1/model/info` 按用户 Key 的权限过滤，返回真实部署。
- `/v1/models` 与 `/model_group/info` 会把团队白名单中的名字原样列出，不校验部署是否存在。
- `model_info.supported_endpoints` 是官方的端点能力字段，但覆盖率低；自定义路由（如 `openai/<name>`）通常没有这个字段。
- 阶梯价以 `*_above_<N>k_tokens` 字段表达。

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

注册一个 provider：`id = "litellm"`，`integrationID = "litellm"`，`name = "LiteLLM"`，`activation = "auto"`，`package = "@opencode/ai/providers/openai-compatible"`（缺省值），并绑定 `sourceConnection = 本次发现所用的连接`，由宿主负责隐藏换号前的旧结果（对应 spec“切换连接时不混用旧结果”）。

每个模型写入：`modelID = model_name`；`package` 按协议取三个原生包之一；`settings.baseURL`；`capabilities`、`limit`、`cost`、`variants`、`name`。
每次 transform 先删除该 provider 下不在本次结果中的模型，再逐个 upsert，保证删除的模型会消失。
- 备选：按协议拆成三个 provider（与旧脚本一致）。放弃原因：用户需要连接三次或理解三个入口；而 `Model.Info.package` 本来就支持按模型选择协议。

### D4. 协议判定与 variants 写入字段

判定规则见 specs/protocol-routing。实现要点：
- `supported_endpoints` 只识别 `/v1/responses` 与 `/v1/chat/completions` 两个值（也接受不带 `/v1` 前缀的写法），其他值忽略。
- variants 的写入目标由协议决定，写入位置是 `Variant.settings`（宿主会把 settings 合并进 provider 选项）。
  - Chat 协议（`openai-compatible`）：`{ reasoning_effort: v }`，即原生包公开的选项名。
  - Responses 协议（`openai-compatible-responses`）：`{ reasoning: { effort: v } }`。
  - Messages 协议（`anthropic-compatible`）：effort 类档位写 `{ effort: v }`，budget 类档位写 `{ thinking: { type: "enabled", budgetTokens: n } }`。

  这些选项名来自原生包 `@opencode/ai@2.0.15` 的类型定义（`providers/openai-compatible.d.ts` 的 `reasoning_effort`，`protocols/open-responses.d.ts` 的 `reasoning.effort`，`protocols/anthropic-messages.d.ts` 的 `effort` 与 `thinking.budgetTokens`）。实施时逐一用真实请求验证（tasks 1.4）。字段名如果不对，只需修改 `modelsdev.ts` 中的映射表，不影响 spec（spec 只规定档位集合与语义）。

### D5. 家族 → 原厂识别

采用有序的前缀 / 正则表，基于模型名匹配（去掉路由前缀后小写）：`gpt-|o\d|codex` → openai；`claude-` → anthropic；`glm-` → zai；`deepseek-` → deepseek；`kimi-` → moonshotai；`mimo-` → xiaomi；`minimax-` → minimax；`qwen` → alibaba；`gemini-` → google。
匹配 models.dev 时使用 LiteLLM 的 `model_info.base_model`（有则优先）或 `model_name`。
- 备选：使用 LiteLLM 的 `litellm_provider`。放弃原因：实测中它大多是 `openai`（经 OpenAI 兼容网关转发），反映的不是模型原厂。

### D6. 阶梯截断

在部署的 `model_info` 中扫描正则 `^input_cost_per_token_above_(\d+)k_tokens$`，只取值非零的字段，取最小的 N。
`limit.context = min(max_input_tokens, N*1000)`，`limit.input` 同步截断。
只看 input 字段：阶梯由输入长度触发，output / cache 的阶梯字段只会跟 input 同时出现，不会单独出现。实测样本中 GPT 系列阶梯点为 272k，minimax-m3 为 512k。

### D7. 刷新、指纹与缓存

- **发现循环**：启动时执行一次 → 之后每隔 `pollInterval` 执行一次（默认 300s，下限 30s）。同时订阅连接变更事件，变更时立即执行，并重置计时。
  事件名以宿主导出的 `Integration.Event`（或 `Credential.Event.Switched`）为准，在 spike 中确认 Promise API 的订阅方式；如果无法订阅，退化为轮询时比较连接 key（credential id + 答案哈希），发现变化即重新发现。
- **指纹**：对 `ModelSpec[]` 做稳定序列化（键排序）后比较字符串，不同才写入缓存并调用 `ctx.provider.reload()`。
- **并发**：同时最多只有一个发现在进行，新触发的发现合并到正在进行的那次。
- **models.dev**：进程内缓存 6 小时。获取失败时按 60 秒退避，下次刷新时重试。插件不在磁盘上写任何缓存。
- **超时**：LiteLLM 请求 15 秒，models.dev 请求 20 秒。

### D8. 失败分类（对应 specs/change-sync）

| 情况 | 行为 |
|---|---|
| 网络错误 / 超时 / 5xx / 响应无法解析 | 保留上次结果，记录 warn，等下个周期 |
| 401 / 403 | 清空结果并 reload，记录 error“Key 无效或无权限” |
| 404（`/v1/model/info` 不存在，LiteLLM 过旧或地址错误） | 按认证失败处理：清空结果并报错，提示检查地址 |
| models.dev 失败 | 按“无记录”继续构建 |

所有日志通过 `net/fetch.ts` 统一脱敏：将 Key 替换为 `sk-***`，并去掉 URL 中的用户信息。

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
| 协议按 `supported_endpoints` > `mode` 判定，不再“GPT 即 Responses” | 与 LiteLLM 管理员的声明一致，对任意部署通用；用户已确认 |
| 单个 provider、按模型选择协议包，取代三个 provider 拆分 | v2 支持模型级 `package`，用户只需连接一次 |
| 使用宿主原生包 `@opencode/ai/providers/*`，不再使用 `@ai-sdk/*` | 原生包内置于 v2 宿主，没有运行时安装；与上游官方插件（lmstudio 等）一致 |
| 上下文窗口按阶梯价字段截断，不再读取 Codex `models_cache.json` | 通用插件不能假设本地装有 Codex；目的相同，都是避开高价区间；用户已确认 |
| 推理档位来源顺序为：原厂 → OpenCode Zen → 唯一 provider（与基线一致），但写入字段按原生包选项名调整 | 包由 `@ai-sdk/*` 换为原生包，选项名不同 |
| Anthropic 判定增加 `litellm_provider` / `custom_llm_provider` | 基线只看 `anthropic/` 前缀，会漏判以 DB 方式配置、前缀不同的部署 |

## Risks / Trade-offs

- [v2 插件 API 在 2.0.x 期间变化] → 宿主调用集中在 `host/`；`peerDependencies` 固定 `>=2.0.15 <2.1`；每次升级宿主时跑 spike 清单（tasks 第 1 组）。
- [原生包的推理选项名与假设不一致，导致档位不生效] → 实施时逐协议做真实请求验证；映射表集中在一处。
- [`mode` 与上游实际能力不符，例如管理员把只支持 chat 的上游标成 responses] → LiteLLM 网关本身会转换协议，一般仍可调用；另外提供协议覆盖作为兜底。
- [连接变更事件在 Promise API 中不可订阅] → 退化为轮询时比较连接 key，最坏情况延迟一个轮询间隔（换号瞬间旧模型已由 `sourceConnection` 隐藏，不会误用旧凭据）。
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
