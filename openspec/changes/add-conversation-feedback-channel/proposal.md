## Why

`/litellm-audit-export` 的结果卡片依赖 OpenTUI 的 `session.composer.top` 插槽与同包 TUI 入口，仅在终端 TUI 客户端可用；OpenCode Desktop / Web（packages/app，Tauri/浏览器前端）不加载 OpenTUI 插件，用户执行命令后文件虽已写入磁盘却完全看不到反馈（`session.command` 对 execute 型命令返回 NoContent，server 不自动插入任何可见消息）。需要一条对 TUI 之外客户端可用的会话内反馈通道。

## What Changes

- 新增配置开关 `conversationFeedback`（默认关闭）。开启后，`/litellm-audit-export` **命令**（不含程序化 RPC `export`）执行完成（无论成功或失败）时，插件通过 `ctx.session.prompt` 向当前会话提交一条极简、确定性文本的 user 消息。
- 消息字段统一为两种固定结构：成功 = 状态、报告完整绝对路径、**该次报告快照**对应的发现状态与模型数；失败 = 失败状态与经固定 allowlist 转换的简短原因（不含路径、不含原始异常文本）。两种结构均以固定标识标注消息为插件生成，不冒充用户手写内容。
- 路径消息文本由插件写死，不依赖模型生成；模型回复仅为宿主常规流程的附带产物，其生成失败不撤销已提交的反馈消息。
- 边界（收窄措辞）：插件构造的消息本身 MUST NOT 包含报告全文、模型清单、价格或凭据等内容，插件 MUST NOT 主动读取报告并送入模型；但插件 MUST NOT 承诺约束模型在后续 agent 回合中的行为（agent 可能持有文件读取工具，模型可能自行读取报告——此风险在文档中向用户披露）。
- TUI 结果卡片、RPC `latest` 通道保持不变：开关不影响卡片行为；TUI 用户默认继续只看卡片。
- **BREAKING**：对在途变更 `fix-model-initialization-and-add-audit-export` 已交付的默认行为无破坏（开关关闭时行为逐位一致）；开关开启路径上有意修订在途能力中"卡片不要求模型调用、路径不提交给模型"的默认契约（见 Capabilities）。

## Capabilities

- **New Capabilities**: 新增 `conversation-feedback`（`specs/conversation-feedback/spec.md`）：审计导出的对话反馈通道，含开关语义、消息内容与快照一致性、失败降级、触发范围（仅命令、RPC 不触发）与隐私边界。
- **Modified Capabilities**: `model-audit-export`（在途变更 `fix-model-initialization-and-add-audit-export` 尚未 archive，其主 spec 未建立）。本变更在合并时将其"主动触发并获知结果"requirement 中的默认契约修订为：**在 `conversationFeedback` 关闭（默认）时**，命令反馈不触发模型调用、卡片路径不提交给模型；开关开启时由 `conversation-feedback` 能力接管反馈。实现方式：若在途变更先行 archive，本变更为其主 spec 生成 MODIFIED delta；若两者同时在途，本变更的合并以在途 delta 的最终文本为基线追加例外条款，合并顺序上**依赖在途变更先行合入**（命令、audit 快照、RPC `latest`、卡片均由在途变更提供接线对象）。

## Impact

- `src/options.ts`：解析 `conversationFeedback` 布尔选项（默认 false，容错非法值）。
- `src/host/audit-command.ts`：导出完成后按开关提交反馈消息；快照元数据（发现状态、模型数）随导出结果在内部结果对象中携带（一次构造、随文件写入同源），不从可变 `snapshot.audit` 二次读取；命令注册需新增 `session` 域依赖。
- `src/index.ts`：将选项传入 audit 注册。
- 依赖面：使用 `@opencode/plugin` 2.0.15 公开的 `ctx.session.prompt`（SessionDomain Pick 已含 `prompt`），无新运行时依赖。
- 文档：README 说明开关默认值、开启成本（每命令一次模型调用）、路径进入会话记录与远端模型日志的隐私含义、模型可能自行读取报告的风险、失败降级行为。
- 验收风险：`session.prompt` 从命令 execute 内调用的实际投递行为（delivery/steer 语义、busy 会话、重入性）在 2.0.15/2.0.16 未实测，任务 1.1 为 go/no-go 门禁：实测不通过则本变更暂停并回写调研文档，不进入实施。
- Desktop e2e：本机未安装 OpenCode v2 Desktop 时，已获用户授权安装最新 v2 版本完成真实实测，测试后保留安装、不卸载（用户后续继续使用）。
