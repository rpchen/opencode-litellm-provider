## Context

OpenCode 侧状态分布（2026-10-01 endpoint-management 之后仍准确）：

| 状态 | 位置 | 所有者 |
|---|---|---|
| endpoint 定义 | 声明插件的 OpenCode 配置文件 `plugins[].options.endpoints`（JSONC，允许注释） | 本插件 + 用户手改 |
| desired activation | 宿主 storage key `litellm.activation.v1` | 本插件 |
| credential | OpenCode 宿主（`/connect` 写入），本插件通过 client API 读 | OpenCode 宿主 |
| discovery snapshot | 宿主 storage key `litellm.discovery.snapshot.v1[.<id>]` | 本插件 |
| `ProviderSnapshot` 运行时视图 | 进程内（`buildExplicit` 中 `Map<string, ProviderSnapshot>`） | 本插件，本轮扩展 |

冻结原则：**配置表达用户意图，runtime 表达现实；UI 必须诚实展示两者，而 `/models` 只承诺现实**。

## Decisions

### D1 Canonical `EndpointState` 模型

新建 `src/host/endpoint-state.ts`，与 Pi 侧语义对齐：

```ts
type DesiredState = "enabled" | "disabled"
type ValidationState = { kind: "ok" } | { kind: "invalid"; reason: string }
type CredentialState = "stored" | "environment" | "none" | "unknown"
type AppliedState =
  | { kind: "active"; lastDiscoveryAt?: string; modelCount: number }
  | { kind: "not-applied" }
  | { kind: "error"; category: ApplyErrorCategory; message?: string; at?: string }

type ApplyErrorCategory =
  | "credential-missing"
  | "config-invalid"
  | "auth"
  | "network"
  | "parse"
  | "cancelled"

interface EndpointState {
  endpointId: string
  desired: DesiredState
  validation: ValidationState
  credential: CredentialState
  applied: AppliedState
}

type UserVisibleStatus =
  | "disabled"
  | "disabled-invalid"
  | "enabled-active"
  | "enabled-needs-authentication"
  | "enabled-not-applied"
  | "enabled-error"
  | "enabled-invalid-configuration"
```

派生规则冻结为（与 Pi 一致）：

```
validation.kind = invalid                 → enabled-invalid-configuration | disabled-invalid（按 desired 选择）
desired = disabled                         → disabled（validation=ok 时）
credential ∈ {none, unknown}               → enabled-needs-authentication
applied.kind = active                      → enabled-active
applied.kind = not-applied                 → enabled-not-applied
applied.kind = error                       → enabled-error
```

中文标签与 Pi 完全一致。

### D2 `parseOptions` 保留 invalid endpoint

- 之前：`endpoint id=company` 的 `baseUrl="ht!tp"` 被 `parseOptions` warn 后跳过，`endpoint-management` 列表看不到该 endpoint。
- 之后：endpoint 仍出现在 `PluginOptions.endpoints`，但附 `validation: ValidationState`；`baseUrl` 字段保留原始值供诊断使用（不传播给 fetch）。
- `EndpointIdentity.fixedBaseUrl` 只对 `validation.kind = "ok"` 的 endpoint 提供；invalid endpoint 不注册到任何 runtime 通道。

### D3 `ProviderSnapshot` 扩展

在现有字段基础上加：

```ts
interface ProviderSnapshot {
  // 既有：ready, connection, apiBaseURL, models, registrationView, audit, diagnostics, publicationState
  // 新增（必填，但 default 值与历史行为一致）
  endpointState: EndpointState
}
```

来源：
- `desired`：由 `index.ts` 在 `reconcile` 时根据 activation 写入；
- `validation`：由 `parseOptions` 计算，reconcile 时同步；
- `credential`：由 `integration.connection.active(integrationId)` + `resolve` 是否给出 `key` 派生；`unknown` 仅在 resolve/抛错路径出现；
- `applied`：由 `createDiscoveryLoop.refreshOnce` 在每条终态路径写入：`active` 仅在模型真正通过 `reload()` 提交后；`error` 带上 category；`not-applied` 用于"已 disable / 未连接 / 尚未尝试"三种。

### D4 `/models` 严格语义（OpenCode 等价）

OpenCode 的 `/models` 是宿主对当前 Plugin provider registration 的视图。严格语义落到 `applyProvider` 的唯一守卫：

```ts
function canPublish(state: EndpointState): boolean {
  return state.desired === "enabled" &&
         state.validation.kind === "ok" &&
         (state.credential === "stored" || state.credential === "environment") &&
         state.applied.kind === "active"
}
```

`applyProvider` 改为只在 `canPublish(snapshot.endpointState)` 时调用 `editor.add({...})`；否则不 add（host 表现为该 provider 不存在）。这与现有 `snapshot.ready && snapshot.connection && snapshot.apiBaseURL` 等价，但通过 canonical state 推导，杜绝"runtime 未 ready 但快照字段凑巧非空"的边缘路径。

`createRegistrationView` 在 `canPublish=false` 时仍会被构造（用于 diagnostics 显示"0 模型、未生效"），但不会 `add`。

### D5 Discovery loop 写入 applied state

`refreshOnce` 现有分类映射到 `ApplyErrorCategory`：

- 无 connection → applied = `not-applied`（desired=enabled 时）+ credential = `none/unknown`
- `!isKeyCredential(resolved)` → `credential-missing`
- 缺 URL → `config-invalid`
- `normalizeLiteLLMURL` 抛错 → `config-invalid`
- `DiscoveryError.kind === "auth"` → `auth`
- `DiscoveryError.kind === "notfound"` → `network`（404 是 LiteLLM 形态问题，非配置非法）
- 其它 `DiscoveryError`（timeout/5xx/429/parse/redirect）→ `network | parse`
- `signal.aborted` → `cancelled`（不覆盖 applied）

snapshot 恢复时（`previousPersisted` 兼容路径）不直接置 `active`：`applied` 仍由本轮 refresh 的成功与否决定。snapshot 只用于让 UI 立刻有上次数据，不承诺 runtime 已应用。

### D6 Endpoint detail 完整化

`multi-audit-command.ts` 中：

- 非 active 分支不再返回三行模板；调用共享的 `createEndpointDetailLines(state, snapshot)`，输出与 Pi 对齐的字段序列。
- overview 行格式与 Pi 完全一致：`✓/○ <id> · <providerId> · <用户可见状态> · models=N`。

### D7 Retry / 重新应用

- TUI `endpoint detail` 在 `userVisibleStatus ∈ {enabled-not-applied, enabled-error, enabled-needs-authentication}` 时额外多一个 `Retry / 重新应用` 选项；触发 `rpc.trigger({ endpointId })`。
- 服务端 `endpointRpc` 新增 `trigger` handler：找到 `disposers.get(id)` 对应的 `DiscoveryLoop`，调 `loop.trigger(true)`。
- Retry 不修改 desired state，不触碰 credential，不触发 `setActivation`，不做 disable→enable 循环。
- Retry 完成后由下一次 `state()` 拉取最新 `endpointState` 并 emit `shown` 事件。

### D8 不侵入 Core

endpoint state、UI 标签、Retry 全部在 adapter。Core 提供 `isEndpointID` + `normalizeLiteLLMURL`，本轮零改动。

### D9 与 Pi 语义对齐

- 状态 token 与中文文案完全一致；
- `/models` 严格语义在两侧实现方式不同（Pi 通过 `refreshModels` 返回值 + unregisterProvider，OpenCode 通过 `applyProvider` 守门），但等价；
- Retry 入口在两侧均存在；两侧都不做自动重试。

## Differences vs baseline

| 差异 | 理由 |
|---|---|
| `parseOptions` 保留 invalid endpoint | 支撑 Disabled/Enabled · Invalid configuration 用户可见状态 |
| `ProviderSnapshot.endpointState` | 派生所有用户可见视图的唯一事实来源，避免 management/diagnostics/TUI 各自拼状态 |
| `applyProvider` 改为基于 canonical state 守门 | 现有 `ready+connection+apiBaseURL` 等价，但缺乏审计性；canonical 化便于测试 |
| Credential "stored" 不再译作 "已连接" | 冻结需求：credential exists ≠ connected |
| Add/Edit URL 校验规则不变 | 与共享 core 的 `normalizeLiteLLMURL` 一致 |

## Risks

- OpenCode 端 `provider.transform` 的 `editor.add` 不是即时同步到 `/models`（host reload 周期）：现有代码已用 `provider.reload()` 触发；本轮沿用，不引入新假设。
- `applied.kind` 只在进程内：重启后短暂窗口内 UI 显示 "已启用 · 未生效" 直到第一次 refresh 完成；README 写明这是预期。
- `/connect` 流的现有用户：状态词汇变化（"已连接"→"已保存 API Key"）是用户可见变化，README 同步说明。
- legacy 单 endpoint 模式（`options.endpoints === undefined`）在 v0.7.0 仍支持；本轮让它也走同一 canonical 模型，不再特殊分支。

## Migration

- 用户无需手工迁移。
- 已有被静默丢弃的 invalid endpoint 升级后重新出现在管理中心，带 `Invalid configuration` 标签；`/litellm-endpoints → 修改 Base URL` 修复后即可正常 enable。
- snapshot storage key 不变；endpoint fingerprint 计算不变。
