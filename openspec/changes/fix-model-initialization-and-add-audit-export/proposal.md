## Why

已发布插件在用户通过 `/connect` 看见模型后，实际发送消息却因运行时无法解析 `@opencode/ai` 而无法初始化模型；此前本地 `dist` 调用成功和 Git package 安装成功均不足以覆盖这一真实安装路径。同时，用户无法导出插件最终交给 OpenCode 的模型元数据与协议选择来核对发现结果。

## What Changes

- 优先定位并修复用户当前 OpenCode 后台服务中从已安装 Git package 选择 LiteLLM Responses 模型后的 SDK package 解析／初始化问题；以真实消息经所选协议到达 LiteLLM 并成功返回作为独立验收，而不是仅验证模型可见或导出成功。
- 增加用户主动触发的只读模型审查 JSON 导出，记录同一次成功发现所生成并提交给 `ProviderEditor.add` 的模型名、推理等级及其他允许的最终 provider／模型字段、每模型协议和 package、采集时间及当前状态；清楚区分保留的旧结果与新结果。报告不携带连接凭据和未经筛选的上游响应，模型名等允许字段按实际注册值保留。
- 用固定样本、负向泄密测试、安装产物 smoke 和隔离 OpenCode 宿主端到端验收覆盖两个目标；补充 README 的导出说明、升级与新版本验证步骤。现有不可变 `v0.1.0` 不会因此变为已修复版本。

## Capabilities

### New Capabilities

- `model-audit-export`：用户显式导出与插件注册输出一致的安全审查报告，并识别数据新鲜度及空状态。

### Modified Capabilities

- `protocol-routing`：在已安装 Git package 的真实 OpenCode 宿主中，模型初始化与所选协议的调用必须可用，不得因 package 无法解析而失败。

## Impact

- 涉及 `src/core/protocol.ts`、`src/host/register.ts`、`src/host/sync.ts`、`src/index.ts`，以及导出入口、选项、测试、README、`dist` 和必要的 package manifest／发行验证。
- 当前依赖 OpenCode v2 `ctx.integration.transform`、`ctx.integration.connection.active/resolve`、`ctx.provider.transform` 的 `ProviderEditor.add`、`ctx.provider.reload`、`ctx.event.subscribe`；使用 `ctx.command.transform` 注册导出命令、`ctx.rpc.register` 发布结构化结果，并由同包 TUI 插件订阅 RPC 事件、即时提示绝对路径。`ctx.session.synthetic(..., resume: false)` 经实测只入 inbox，不用作即时反馈；TUI 入口仍须在真实宿主验证。
- 当前失败的 `deepseek-v4.1-flash` 使用非内置的 `@opencode/ai/providers/openai-compatible-responses`。宿主对非内置 `@opencode/ai/*` 直接动态导入、不自动安装，对内置入口静态导入；拟将 Responses／Messages 映射到宿主内置入口，Chat 保持原内置入口。仍须在用户当前失败的宿主路径实测新映射，不能因另一安装位置成功就宣称已修复；无生命周期脚本、提交 `dist`、required CI 等分发约束保持不变。
