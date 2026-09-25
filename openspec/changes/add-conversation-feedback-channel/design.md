## Context

参见 proposal.md。当前 `/litellm-audit-export` 的可见反馈依赖同包 TUI 入口（`src/tui.ts`）在 `session.composer.top` 插槽渲染卡片；Desktop/Web（packages/app）不加载 OpenTUI 插件，`session.command` 对 execute 型命令返回 NoContent，执行结果对用户完全不可见。

**上游 v2 源码证据**（2026-09-25 核查；注：项目调研文档 2026-09-23 版写的"beta 分支为 v2 准、dev 为 v1 线"已过时——当前上游默认分支 dev 已包含完整 v2 线的 `packages/core` 与 `packages/app`，2.0 分支反而没有 `packages/core`；实施时应以实际 commit 为准重新核对并更新调研文档）：

- TUI 时间线只按 `role` 渲染 user/assistant 消息：`packages/tui/src/routes/session/index.tsx` 的 `<Match when={message.role === "user"}>` / `assistant` 分支，无 synthetic 分支。
- Desktop/Web 时间线同样只按 role 渲染：`packages/app/src/pages/session/message-timeline.tsx`。
- `SessionMessage.Synthetic`（`@opencode/schema/dist/session-message.d.ts`）无 role 字段；两客户端时间线均不渲染该类型。`core/src/session/message-updater.ts` 将 synthetic 事件投影为会话消息（对模型可见），`runner/to-llm-message.ts` 将其转为 `role: "user"` 的 LLM 输入——但 UI 渲染层不显示。
- `session.prompt` 提交的 user 消息是唯一在 TUI 与 app 时间线均渲染的公开通道（`@opencode/plugin/dist/promise/session.d.ts` SessionDomain Pick 含 `prompt`；protocol 定义 `POST /api/session/:sessionID/prompt`）。
- v2 命令执行（`POST /api/session/:sessionID/command`）返回 NoContent，server 不为 execute 型命令自动插入会话消息。
- 本机已实测（2026-09-24 验收）：`ctx.session.synthetic({ resume: false })` 仅入 inbox 不显示。

## Goals / Non-Goals

**Goals:**
- 为导出结果提供对 Desktop/Web 可用（TUI 亦可并存）的会话内反馈：插件构造的确定性 user 消息 + 宿主常规模型回复。
- 反馈内容最小化且与报告快照原子一致：状态、绝对路径、发现状态、模型数一次捕获。
- opt-in：默认关闭，TUI 用户体验与在途变更已验收行为完全不变。

**Non-Goals:**
- 不替代或修改 TUI 卡片、RPC `latest`、文件写入路径、审计报告内容与安全序列化（属在途变更 `fix-model-initialization-and-add-audit-export` 的能力边界）。
- 不探测客户端类型（宿主无公开 API 区分 TUI/Desktop）。
- 不约束模型在后续 agent 回合中的工具行为（无公开机制禁用 agent 文件读取工具；不承诺"报告绝不进上下文"）。
- 不让模型组织/重写路径内容，不提供"模型读报告并总结"功能。

## Decisions

### 1. 反馈通道选择 session.prompt，而非 synthetic 或 MCP 工具

- **session.prompt**：提交的 user 消息在 TUI 与 app 的时间线均渲染，随后模型常规回复，是唯一跨客户端可见的公开通道。路径文本由插件写死进 user 消息，权威内容不依赖模型。
- **synthetic**（`ctx.session.synthetic`）：消息 type 为 `synthetic`、无 role 字段，TUI 与 app 的时间线渲染循环均不渲染该类型（见 Context 证据）；只进 inbox 等待消费，对模型可见但 UI 不可见。已在 2.0.15/2.0.16 实测确认不即时显示。
- **MCP 工具**：需用户与模型对话触发，工具结果渲染路径两客户端不一致待查，且改变"用户敲命令"的交互范式。留作未来可选增强，不进本变更。

### 2. 触发范围：仅命令，RPC 不触发

`performExport` 同时被命令 `execute` 与公开 RPC `export` 调用（`src/host/audit-command.ts`）。反馈只在命令路径注入：命令分支在导出完成后调用反馈提交，RPC 分支不接。理由：程序化 RPC（脚本、TUI 卡片自身的 `latest` 轮询、未来第三方集成）不应产生用户未预期的模型成本。负向场景（RPC 不触发反馈、不调模型）进单测。

### 3. 原子快照：一次捕获，随导出结果同源

现有 `latest` RPC 结果只有 `sequence/sessionID/ok/path/error`，没有发现状态与模型数。方案：**扩展内部导出结果对象**（`performExport` 在写文件前与报告同源捕获一次 audit 快照元数据——发现状态、模型数），反馈消息读该内部对象，**不扩展公开 RPC schema**（避免再次修改在途能力的 RPC 契约）。这消除 TOCTOU：文件写入期间连接切换时，消息状态/模型数仍对应写入文件的那次快照。公开 RPC 的 `latest` 返回保持不变。

### 4. 消息构造与安全边界

- 消息构造为纯函数（导出结果内部对象 → 确定性文本），便于单测。
- 成功 = 插件生成标识 + 状态 + 完整绝对路径 + 发现状态 + 模型数；失败 = 插件生成标识 + 失败状态 + 固定类别映射原因（沿用 `failureMessage()` allowlist 风格，不拼接原始异常）。失败不含路径占位符。
- 路径编码安全：转义 CR/LF 与控制字符（如 JSON 字符串内嵌或统一替换），防止路径内容被解释为换行注入/指令；单测覆盖空格、引号、反斜杠、换行、Unicode。
- 边界措辞（对齐 spec）：插件消息本身不含报告内容/凭据，插件不主动读报告送入模型；**不承诺**模型后续回合不通过文件工具自行读取报告——README 披露此风险。

### 5. 宿主验证门禁：已通过（2026-09-25 实测）

`session.prompt` 从命令 execute 上下文调用已在 2.0.15 与 2.0.16 双版本实测（方法与原始数据见 `docs/research/opencode-v2-plugin-api.md` 末节）：
- execute 内同步调用 prompt 可用，46ms 内 resolve；命令在 11–55ms 内完成，不等待模型生成。
- 空闲会话：消息立即出现在会话消息列表（`type: user`，文本为插件所写），且对会话上下文（模型输入）可见——与 synthetic 形成明确对照（synthetic 消息列表 0 条、仅入 inbox）。
- 忙碌会话（模型请求长时间未返回）：命令不阻塞、不拒绝；反馈消息进入 inbox（`type: user`，默认 delivery 解析为 `steer`），在当前回合结束后可被消费显示，不丢失。
- 三个 delivery 形态（未指定 / `queue` / `steer`）在空闲会话无可见差异。

**选定**：使用默认投递（不显式指定 `delivery`），由宿主 inbox 语义决定排队；命令侧不等待模型回复，返回时机为 `prompt` resolve 之后。原"no-go 即停止实施"的分支结论为 go，后续任务按此实施。

### 6. 投递时序与降级（修订）

完整时序：① 构造报告 + 原子捕获快照元数据 → ② 文件写入 → ③ 更新 `latest` 并 emit RPC completed → ④ 提交反馈 prompt（按门禁实测选定的时机与 delivery）→ ⑤ prompt 拒绝/挂起时：捕获 rejection、记录日志、命令照常完成（不无限等待；fire-and-forget 形态下迟到 rejection 在卸载前由统一 catch 处理，插件卸载后不再处理）。反馈提交失败静默降级：文件已写、卡片/RPC 照常，符合 spec"反馈提交失败"场景；命令执行等待时长有界（实测确定上限，超时按失败降级处理）。

### 7. 开关解析与注入

`src/options.ts` 增加布尔选项 `conversationFeedback`（默认 false，非布尔值容错为 false）；`src/index.ts` 将选项传入 `registerAudit`；开关只影响命令完成后的反馈分支，不改变命令注册、RPC、卡片。

### 8. 与在途变更的关系（修订：声明真实依赖）

在途变更 `fix-model-initialization-and-add-audit-export` 提供本变更的全部接线对象：导出命令、audit 快照、`latest`/completed RPC、TUI 卡片，且两变更同改 `src/host/audit-command.ts`。**合并顺序依赖在途变更先行合入**；本变更实施前固定在途变更基线 commit，实施期间每次其更新后 rebase 并重跑两变更相关测试（audit 命令/RPC/TUI 渲染），合并前检查两 delta spec 组合后的规范一致性（在途"卡片不调模型/路径不进模型"默认条款 + 本变更开关开启例外条款无矛盾）。

与 `opencode-litellm-config-sync` 行为基线差异：旧脚本写静态配置文件、无任何会话内反馈概念，本能力在基线之外新增，不偏离任何既有元数据规则（差异 → 理由：新增交互能力，不涉及模型发现/映射）。

## Risks / Trade-offs

- [`session.prompt` 在命令 execute 上下文中的投递行为未实测] → 任务 1.1 go/no-go 门禁；no-go 则暂停修订提案，不带病实施。
- [路径进入会话记录/远端日志的隐私含义（用户名、目录结构、会话导出、第三方模型日志、assistant 复述）] → opt-in 默认关；README 逐项披露；消息最小化。
- [模型可能经文件工具自行读取报告] → 无法约束，README 披露；消息本身不含报告内容。
- [每次导出多一轮模型调用成本] → 开关默认关闭；文档写明；RPC 路径不触发。
- [与在途变更在同文件并行修改冲突] → 声明合并顺序依赖；实施前固定基线、每次 rebase、合并前组合一致性检查。
- [Desktop e2e 环境缺失] → 已授权：安装最新 v2 Desktop（官方分发入口）完成实测，测试后保留不卸载；安装/运行本身失败才适用 4.5 例外规则。
- [宿主 prompt API 未来变化（v2 API 未完全稳定）] → 反馈失败静默降级到既有通道，不破坏导出主流程。
- [transcript 中出现用户未打过的消息] → 消息固定标注插件生成（进 spec 与单测），README 说明。
- [路径含换行/控制字符的注入面] → 编码安全处理 + 边界单测。

## Migration Plan

1. 任务 1.1 宿主 go/no-go 验证（2.0.15 + 2.0.16），回写调研文档与 design。
2. 新分支实现：options 解析 → 消息纯函数 → 提交模块（超时/降级）→ audit-command 接线（快照元数据扩展）→ 单测。
3. 本地门禁：`bun run typecheck`、`bun test`、`bun run build:dist`、`bun run test:package`。
4. 真实宿主验收（TUI 必做；Desktop 按任务 4.3–4.5：本机未安装时安装最新 v2 Desktop（已获用户授权，测试后保留不卸载）并完成真实 e2e）。
5. 经 PR + required CI 合并（在途变更先行），合并后 main CI 通过。
6. 按不可变新 tag 发行：Release 工作流版本匹配、tag Git package smoke、tarball 与 SHA-256 校验；Release 说明如实记录开关行为与 Desktop 验收状态。
7. 安装验证：默认 GitHub spec 与固定新 tag 两种入口各自装回真实宿主，验证插件加载、发现注册无回归、开关关闭逐位一致与开关开启对话反馈可用（对齐在途变更 5.4 的既有验收模式）。

## Open Questions

（已解决）delivery 采用默认投递，见 Decisions §5；命令不做额外等待上限（`prompt` 实测快速 resolve，不阻塞命令）。
（无）——Desktop 验收环境已获用户授权解决：本机未安装 OpenCode v2 Desktop 时，允许安装最新 v2 版本完成真实 e2e，测试后保留安装不卸载；能力验收以 Desktop e2e 为必要门禁（例外仅在 Desktop 安装/运行本身失败时适用，见任务 4.5）。
