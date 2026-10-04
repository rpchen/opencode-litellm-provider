## Why

OpenCode 侧与 Pi 侧共享同一组用户可见状态语义问题：

- endpoint 只暴露 `active: boolean`；runtime apply 失败（未连接、URL 无法规范化、首次 discovery 失败）时 `/litellm-endpoints` 仍显示"已启用"，无法解释 `/models` 为空的原因。
- credential 状态被翻译为 "已连接" / "未连接"，把 credential exists、endpoint reachable、endpoint applied 混为一谈。
- 非法 baseUrl 的 endpoint 被 `parseOptions` 静默丢弃，管理中心与 `/litellm-diagnostics` 都看不到。
- `/litellm-diagnostics <endpoint-id>` 对未激活 endpoint 退化输出 3 行模板，而不是完整 detail。
- 没有 Retry / Apply again 入口。
- 历史 snapshot 在某些边界下仍可能让模型出现在 `/models`，与真实 runtime 状态不一致。

冻结原则：**配置表达用户意图，runtime 表达现实；UI 必须诚实展示两者，而 `/models` 只承诺现实**。

## What Changes

- 与 Pi 侧共享同一内部状态词汇表：`desired` × `validation` × `credential` × `applied`，派生同一组用户可见状态 token（`enabled-active` / `enabled-needs-authentication` / `enabled-not-applied` / `enabled-error` / `enabled-invalid-configuration` / `disabled` / `disabled-invalid`）与同一组中文标签。
- `parseOptions` 不再静默丢弃非法 endpoint：endpoint 定义保留，附 `validation` 结果。
- `ProviderSnapshot` 扩展携带 `desired`/`validation`/`credential`/`applied` 分类与最近错误；`applyProvider` 仅在等价于 "desired=enabled ∧ validation=ok ∧ credential ok ∧ applied=active" 时向 OpenCode 注册模型视图。
- `/litellm-endpoints` 列表行、endpoint detail 标题、`/litellm-diagnostics` overview 与 detail 全部由 canonical state 派生，不再各自拼装。
- `/litellm-diagnostics <id>` 对任意状态（禁用、非法、缺凭据、未生效、出错）输出完整 endpoint 字段，不再退化为占位。
- Credential 状态文案从"已连接"改为"已保存 API Key" / "需要认证"；不再用 "connected" 描述仅"已保存"的状态。
- 新增 **Retry / 重新应用**：`desired=enabled` 且 applied≠active 时在 endpoint detail 提供 Retry，触发该 endpoint 的强制 refresh。
- 本轮仍**不**实现：endpoint CRUD 之外的字段编辑 UI、pollInterval/contextTierCap UI、持续 health monitoring、自动 backoff/retry、release pipeline redesign。

## Capabilities

### New Capabilities
- `endpoint-state-consistency`: 规范化 desired/validation/credential/applied 四元组模型在 OpenCode adapter 的落地，包含管理 UI、diagnostics、`/models` 可见性与 Retry 入口。

### Modified Capabilities
- `multi-endpoint-activation`: activation 仍只表达 desired enabled/disabled；runtime 失败不会修改 persisted activation。
- `endpoint-management`: 列表/详情改为 canonical 派生；新增 Retry 操作；非法 endpoint 仍在列表中可见。
- `provider-diagnostics`: `/litellm-diagnostics <endpoint-id>` 不再退化为占位；对每个 endpoint 输出完整 canonical 字段。

## Impact

- **使用的 OpenCode v2 插件 API**：`Plugin.Context` `integration` / `provider` / `command` / `rpc` / `storage` / `event`，以及 TUI 端 `dialog.select/prompt/confirm`。兼容区间仍为 OpenCode >=2.0.15 <2.1（Real E2E 固定 2.0.16）。
- **与共享 core 的边界**：core 不修改。endpoint id 与 URL 校验继续走 core 的 `isEndpointID` / `normalizeLiteLLMURL`（通过 `src/endpoint-input.ts`）。
- **持久化**：`litellm.activation.v1` 语义不变；`litellm.discovery.snapshot.v1[.<id>]` 形状不变；applied 状态只在进程内。
- **README**：管理中心、diagnostics、常见问题章节同步新状态词汇与 Retry；新增 `/models` 严格语义段落。已有 `jsonc` 标签的配置示例保持 JSONC（含注释），不带注释的示例审计为 strict JSON。
- **与 Pi 侧协同**：与 `rpchen/pi-litellm-provider` 的 `improve-user-visible-state-consistency` change 使用相同的状态 token 与中文用户文案。两侧只共享语义，不共享代码。
- **测试**：既有 31 个 test 文件 + 新增专项（endpoint-state、management、diagnostics、E2E）。遵循 `litellm-discovery-core/docs/testing-standard.md`。
