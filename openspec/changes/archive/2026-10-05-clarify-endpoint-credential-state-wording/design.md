# Design: clarify-endpoint-credential-state-wording

## 背景与约束

`improve-user-visible-state-consistency`（archive 2026-10-05）已把用户可见 credential 状态冻结为
`stored / environment / none / unknown`，且 canonical `endpoint-state-consistency` 明确规定
"UI copy MUST NOT call a stored credential \"connected\""。

但 canonical `endpoint-management` 的 `Credential management` requirement 以及
`[LIST-MULTI]`、`[ADD-INACTIVE]`、`[DEL-NO-GHOST]` 等 scenario 仍使用旧的
Connected / Not connected 表达。这是一个规格内部矛盾：两个 canonical capability 对同一状态给出不同定义。

本 change 是 review fix 性质的最小 follow-up：只修正**表达**，不引入任何新产品能力、不改状态机。

## 冻结语义（本 change 重申、不重新设计）

- credential saved ≠ endpoint connected ≠ runtime applied
- 用户可见 credential 状态只有四种：`已保存 API Key` / `未保存 API Key` / `API Key 来自环境变量` / `凭据状态未知`
- `已连接` / `未连接` / `connected` / `disconnected` 不得作为用户可见 credential 状态标签

## 允许保留的 "connection" 用语（不重命名底层概念）

- `连接 API Key` / `Connect`：**操作名称**（按钮、命令项）。
- `ConnectionInfo`、`integration.connection`、`snapshot.connection`：OpenCode SDK / transport 工程概念。
- `DiscoveryStatus` 内部枚举值 `disconnected`：discovery runtime 工程状态，不落为 credential 标签。
- "connected address"（legacy 迁移语境）：指 legacy `default` 实际配置的地址，不是 credential 状态标签。

## 决策

### D1: requirement 表达与 canonical 状态对齐

`Credential management` requirement 的状态展示从 "Connected / Not connected" 改为四种
credential 标签，并显式写明 "labels MUST NOT describe a credential as Connected / Not connected"。
受影响 scenario（`[LIST-MULTI]`、`[ADD-INACTIVE]`、`[CRED-CONNECT]`、`[CRED-REPLACE]`、
`[CRED-CONNECT-CONSISTENT]`、`[DEL-NO-GHOST]`）同步改用 saved/not-saved 表达。

### D2: Add 成功 toast

`src/tui-endpoints.ts` 的
`已添加 endpoint ${id}（未启用、未连接）。请在列表中选择它来连接 API Key 并启用。`
改为
`已添加 endpoint ${id}（未启用、未保存 API Key）。请在列表中选择它来连接 API Key 并启用。`
"连接 API Key" 是操作名称，保留。

### D3: migrate 失败消息

`src/host/endpoint-manager.ts` 的
`没有可迁移的 legacy 地址（当前没有已连接的 LiteLLM endpoint）`
改为
`没有可迁移的 legacy 地址（当前没有配置地址的 LiteLLM endpoint）`。
该消息描述的是 legacy 地址缺失，不是 credential 状态。

### D4: DiscoveryStatus 的用户可见渲染

`src/host/diagnostics.ts` 与 `src/host/audit-feedback.ts` 中
`disconnected: "未连接"` 的**用户可见渲染**改为 `disconnected: "尚未发现 LiteLLM"`。
理由：该状态实际含义是"该 endpoint 在当前进程里还没有完成任何 discovery apply"
（`snapshot.audit.status === "disconnected"`），与"credential 是否保存"无关；
渲染成"未连接"会让用户把它读成 credential/连接状态。内部枚举值 `disconnected`
（`register.ts` 的 `DiscoveryStatus`、snapshot/audit fixture）是工程术语，不改名，
测试 fixture 继续使用该枚举值。
`sync.ts` 的 note `LiteLLM 尚未连接。` 同步改为 `尚未开始 LiteLLM 发现。`。

### D5: README 排障标题

`### 连接成功但看不到模型` 改为 `### 已保存 API Key 但看不到模型`。
正文已按七状态模型排障，语义不变。README 中解释性的
"已保存 API Key 不等于已连接" 保留。

### D6: 测试与负向断言

- `test/tui-endpoints.test.ts` 的 `[ADD-OK][ADD-INACTIVE]` 断言改为
  `未启用、未保存 API Key`，并新增负向断言：toast 不含 `未连接`。
- `test/endpoint-state.test.ts` 已有 `credentialLabel` 不含 `已连接/connected` 的负向断言，
  扩展为同时断言 `未连接`/`disconnected` 不出现。
- 涉及 diagnostics 渲染的测试若断言 `未连接` 文案则同步更新；fixture 使用枚举值 `disconnected` 的构造不受影响。

## 明确不做

- 不改 `EndpointState` 结构、七种状态 token、`canPublish`、`canRetry`、Retry 行为、`/models` contract。
- 不改 discovery / recovery / mutation semantics。
- 不重命名 `DiscoveryStatus` 枚举或 SDK `ConnectionInfo`。
- 不修改任何旧 archive。