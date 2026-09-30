## Why

PR9 只提供 endpoint activation。用户新增、修改 Base URL、删除 endpoint 或管理某个 endpoint 的凭据时，仍必须手改 `opencode.jsonc` 或逐个走 `/connect`。本变更把 `/litellm-endpoints` 升级为全局 LiteLLM endpoint 的日常管理入口。

## What Changes

- `/litellm-endpoints` 用 OpenCode 原生 TUI 对话框（`dialog.select / prompt / confirm`）支持：列出、Add（ID + Base URL）、Edit（仅 Base URL）、Delete（确认 + 完整清理）、Activate/Deactivate、凭据状态、Connect / Replace API Key / Disconnect。
- 只做全局 endpoint；不做项目级、rename、load balancing、failover、高级配置 UI、通用 JSON 编辑器。
- canonical endpoint 配置仍只有一份：声明本插件的 OpenCode 配置文件里的 `plugins[].options.endpoints`。UI 写入用 `jsonc-parser` 做最小文本编辑，保留注释、格式、未知/高级字段；原子替换 + 冲突检测；无法解析或被其它来源遮蔽时拒绝写入。
- 凭据由 TUI 通过宿主自己的 client API（`integration.connect.key` / `credential.*`）写入，与 `/connect` 是同一 backend；API Key 不经过插件 RPC，也不回显。
- 服务端改为“可重建 runtime”的 supervisor：endpoint 集合变化后整体重建 integration/provider/audit 注册，`/litellm-endpoints` 命令与 RPC 常驻。
- README 增加用户使用说明。

## Capabilities

### New Capabilities
- `endpoint-management`: `/litellm-endpoints` 的 endpoint CRUD、凭据管理、activation 与配置安全语义。

### Modified Capabilities
<!-- multi-endpoint-activation 语义不变，本能力只叠加管理入口 -->

## Impact

- 使用的 OpenCode V2 API：`command.transform`、`rpc.register`、`integration.transform/reload`、`provider.transform/reload`、`storage`、`plugin.list`；TUI 侧 `ui.dialog.select/prompt/confirm`、`client.integration`、`client.credential`。兼容区间仍为 `>=2.0.15 <2.1`（真实 E2E 固定 2.0.16）。
- 新增运行时依赖：`jsonc-parser@3.3.1`（MIT，零依赖）。理由见 design.md D2。
- 与共享 core 的边界：**不修改 core**；endpoint id / URL 校验复用 core 公共入口的 `isEndpointID` 与 URL 归一化。
- 插件 options 里的 endpoint 集合现在会在运行期变化，`setupLiteLLM` 保持 `(context, dependencies)` 调用形态。
