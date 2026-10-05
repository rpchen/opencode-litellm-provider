## Why

`improve-user-visible-state-consistency`（已归档）把用户可见 credential 状态冻结为
`stored / environment / none / unknown`，并禁止把"已保存 credential"称为"已连接"。
但审计发现 canonical `endpoint-management` spec 的既有 requirement 表达仍残留旧的
connection 语义：

- `Credential management` requirement 仍写 "The management UI SHALL show Connected / Not connected per endpoint"。
- `[LIST-MULTI]`、`[ADD-INACTIVE]`、`[DEL-NO-GHOST]`、`[CRED-CONNECT]`、`[CRED-REPLACE]`、`[CRED-CONNECT-CONSISTENT]` 等 scenario 仍把 credential 状态描述成 Connected / Not connected。

这与 canonical `endpoint-state-consistency` 的 "Credential state is not \"connected\"" requirement 直接矛盾，也让实现与测试中的 wording fix 缺少可追踪的规格依据。旧 archive 不可变，closure gate 要求 canonical 的变化必须能由 archive history 重放得到，因此需要一个新的最小 follow-up delta。

## What Changes

- 修正 `endpoint-management` 的 `Credential management` requirement 及受影响 scenario 的**表达**：credential 状态标签一律为"已保存 API Key / 未保存 API Key / API Key 来自环境变量 / 凭据状态未知"（英文等价 saved / not saved / from environment / unknown），不再出现 Connected / Not connected 作为 credential 状态。
- 明确冻结语义不变：credential saved ≠ endpoint connected ≠ runtime applied；`已连接/未连接/connected/disconnected` 不得作为用户可见 credential 状态标签。
- 保留："连接 API Key / Connect" 作为**操作名称**；底层 OpenCode SDK / transport 的 `connection` 工程术语；`/connect` 命令名。
- 同步修正实现与测试中残留的旧 wording：
  - `src/tui-endpoints.ts` Add 成功 toast 的"未启用、未连接"改为"未启用、未保存 API Key"。
  - `src/host/endpoint-manager.ts` migrate 失败消息"当前没有已连接的 LiteLLM endpoint"改为按保存的 credential 表达。
  - `src/host/diagnostics.ts` / `src/host/audit-feedback.ts` 的 `disconnected: "未连接"` 状态渲染改为不与 credential 语义混淆的运行时表达。
  - README 常见问题标题"连接成功但看不到模型"改为"已保存 API Key 但看不到模型"。
  - 对应测试断言同步更新并新增负向断言。

## 不改变的内容（冻结边界）

- `EndpointState = desired × validation × credential × applied` 结构与七种状态 token 不变。
- `canPublish` / `canRetry` / Retry 行为 / `/models` strict contract 不变。
- discovery / recovery / mutation semantics 不变。
- 不重命名底层 SDK `ConnectionInfo` / `connection` 概念；`DiscoveryStatus` 内部枚举值 `disconnected` 属于 discovery runtime 工程状态，仅调整其**用户可见渲染文案**。

## Impact

- 用户可见文案：endpoint 管理列表状态、toast、诊断状态行、README 排障标题。
- 无持久化格式、无 API 契约、无状态机变化；`litellm-discovery-core` 不修改。
- 测试：`test/tui-endpoints.test.ts`、`test/endpoint-state.test.ts`（扩展负向断言）、涉及 diagnostics 渲染的测试。