# 真实环境验收记录

## 2026-09-24：OpenCode 2.0.15 与 LiteLLM

### 范围与安全措施

- 宿主版本：OpenCode 2.0.15。
- 以独立的 XDG config/data/cache/state 目录启动本地验收 server，不读取或修改日常 OpenCode 数据。
- 加载当前仓库 `dist` 目录中的实际构建产物，而不是直接调用插件内部函数。
- LiteLLM 地址和 API Key 仅在运行时从任务指定的 `.env` 读取并保存在进程内。
- 本文不记录 API Key、LiteLLM 地址、原始响应体或其他部署内部字段。
- 没有逐个探测发现到的模型；每种实际存在的协议只选择一个代表模型进行调用。

### 插件加载与连接

- 本地构建产物成功加载，插件状态为 active。
- `litellm` integration 与 `LiteLLM` provider 均成功注册。
- 通过 integration 的 key 连接接口提交地址与 Key，等价于 `/connect` 表单流程。
- OpenCode 的本地插件目录解析要求入口位于所配置目录的根部，因此开发态 `file://` 配置必须指向 `dist`，不能指向仓库根目录；README 已按实测结果说明。

### 模型发现

- 直接读取 LiteLLM 模型信息并按插件规则过滤后：18 个对话模型。
- OpenCode `model.list()` 中 `litellm` provider 的模型：18 个。
- 集合比较结果：缺失 0 个，多余 0 个。
- provider 级与模型级数据均未包含 API Key。

### 协议与真实调用

| 协议 | 部署中存在 | 真实调用 | 请求路径验证 |
|---|---:|---:|---|
| OpenAI Chat Completions | 是 | 成功 | `/v1/chat/completions` |
| OpenAI Responses | 是 | 成功 | `/v1/responses` |
| Anthropic Messages | 否 | 按任务的“若有”条件跳过 | 未声称已验证 |

Responses 模型成功使用 `@opencode/ai/providers/openai-compatible-responses`，确认该非内置首选包可在 OpenCode 2.0.15 的实际构建中加载和调用。当前部署没有 Claude/Messages 模型，因此 `@opencode/ai/providers/anthropic-compatible` 的真实加载及 Messages 鉴权仍需在未来出现相应部署时复核。

### Reasoning variants

通过只记录协议路径和 reasoning 选项的本地转发层检查实际出站请求；未记录 prompt、Authorization header 或完整请求体。

- Chat 代表模型选择 `high` 后，请求包含 `reasoning_effort: "high"`。
- Responses 代表模型选择 `high` 后，请求包含 `reasoning: { effort: "high" }`。
- 两个请求均由真实 LiteLLM 后端成功完成。

这确认了宿主会应用模型 variant，并且 `reasoningEffort` 会由各协议包转换为相应 wire 字段。

### 阶梯上下文截断

在 OpenCode 返回的模型信息中确认：

- 带 272k 输入价格阶梯的 GPT 系列模型，其 `limit.context` 与 `limit.input` 均为 272000。
- 带 512k 阶梯的 MiniMax-M3，其 `limit.context` 与 `limit.input` 均为 512000。

### 连接和失败同步

验收配置把 `pollInterval` 调整为允许的最小值 30 秒：

- 在一次成功发现后使 LiteLLM 网络路径不可达，等待超过一个完整轮询间隔；18 个上次成功模型仍然保留。
- 切换到无效 Key 后，旧模型清单被撤下，OpenCode 中该 provider 的模型数变为 0。
- 恢复有效连接后，18 个模型重新出现。

管理员侧真实新增/删除模型未在本轮执行。2026-09-24 用户明确决定将此操作性验收推迟到未来真实发生模型变更时；若届时出现问题，再反馈并迭代。本轮以自动化测试覆盖同一同步路径：轮询响应从一个模型变为两个模型后整体刷新，再从两个变为一个后删除消失模型。

### 结论

本轮已验证构建产物加载、连接表单对应 API、模型集合一致性、Chat/Responses 路由、reasoning variant 参数、阶梯截断，以及断网、无效 Key 和连接恢复行为。当前环境不具备 Messages 部署，管理员模型增删也按用户决定延期；两项均未伪报为已实测。
