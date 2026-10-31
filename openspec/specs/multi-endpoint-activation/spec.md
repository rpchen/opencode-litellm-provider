# multi-endpoint-activation Specification

## Purpose
Defines how the OpenCode plugin exposes multiple globally configured LiteLLM endpoints as isolated integrations/providers, manages their independent credentials and activation state, and keeps diagnostics/UI behavior available without unsupported runtime child-plugin APIs.

## Requirements

### Requirement: multiple endpoints run in one supported OpenCode V2 plugin context
The plugin SHALL implement explicit multi-endpoint runtime using public OpenCode V2 integration/provider transforms and SHALL NOT require runtime child-plugin add/remove APIs.

#### Scenario: two explicit endpoints load on a real V2 context shape
- **WHEN** `default` and `company` are configured and the host context does not expose `plugin.add/remove`
- **THEN** plugin setup succeeds and both endpoint integrations are registered

### Requirement: endpoint credentials are independently addressable
Each configured endpoint SHALL have a stable independent integration id so OpenCode can persist and resolve a distinct API Key for each endpoint.

#### Scenario: user connects two endpoint credentials
- **WHEN** the user opens `/connect` for `LiteLLM` and `LiteLLM · company`
- **THEN** credentials are stored and resolved under `litellm` and `litellm-company` independently

### Requirement: activation does not remove credential integrations
Deactivating an endpoint SHALL stop its provider/discovery runtime without deleting the endpoint integration or previously saved credential.

#### Scenario: inactive endpoint remains connectable
- **WHEN** `company` is deactivated
- **THEN** its provider/discovery stops while the `litellm-company` integration remains available for credential management

### Requirement: multi-endpoint commands remain visibly actionable
The plugin SHALL keep diagnostics, activation, and audit command results visibly actionable in the terminal TUI when explicit multi-endpoint mode is configured. Endpoint activation SHALL use a host-native selectable control rather than text that merely looks clickable, and a command executed before the TUI event listener is ready SHALL be recoverable from server state without a model turn.

#### Scenario: command executes after multi-endpoint setup
- **WHEN** an explicit multi-endpoint configuration loads successfully and the user executes a LiteLLM command
- **THEN** the server RPC/event path reaches the TUI result card without requiring a model turn

#### Scenario: command executes immediately after multi-endpoint startup
- **WHEN** an explicit multi-endpoint configuration loads and the user executes a LiteLLM command before or during TUI plugin initialization
- **THEN** the result becomes visible through the live RPC event or subsequent state/latest recovery
- **AND** no model turn is required

#### Scenario: user toggles an endpoint in the terminal selector
- **WHEN** the user opens `/litellm-endpoints`
- **THEN** OpenCode presents a native selectable list containing every configured endpoint plus all/none/close actions
- **AND** host keyboard navigation and Enter can execute the selected action
- **AND** host mouse selection can execute the same action
- **AND** the selector refreshes to show the updated active state until the user closes it

### Requirement: fixed endpoint authentication methods are schema-valid
For an endpoint whose base URL is already fixed by plugin configuration, the plugin SHALL register a key authentication method without an empty form. If a form is present, it SHALL contain at least one valid host form field.

#### Scenario: fixed baseUrl endpoint appears in connect
- **WHEN** `default` and `company` have configured base URLs
- **THEN** real latest OpenCode `integration.list` returns both integrations without schema validation failure
- **AND** each integration exposes a key method with no `form: []`

### Requirement: supported OpenCode releases have a real-host delivery gate
The plugin SHALL exercise the delivered Git package against the latest stable real OpenCode host, resolved to an exact version per run, including the terminal interaction path for user-visible activation behavior.

#### Scenario: real OpenCode 2.0.16 multi-endpoint delivery
- **WHEN** CI installs the current fixed Git commit through OpenCode's own plugin installer and starts a real latest OpenCode server and terminal client (the scenario title is a historical identifier)
- **THEN** the LiteLLM server plugin becomes active
- **AND** LiteLLM commands can be invoked before endpoint credentials exist without a silent lost-result failure
- **AND** `litellm` and `litellm-company` integrations are visible
- **AND** independent credentials can be stored for both integrations
- **AND** both endpoint providers and model namespaces become available
- **AND** the real terminal selector can disable one endpoint through keyboard input
- **AND** the disabled provider/model namespace disappears while the other remains available
- **AND** the endpoint can be re-enabled through the same terminal path

### Requirement: endpoint credential isolation is proven against real HTTP discovery
The real-host gate SHALL use distinct endpoint credentials and SHALL fail if credentials are crossed or shared incorrectly.

#### Scenario: two endpoints receive their own key
- **WHEN** different keys are saved for `litellm` and `litellm-company`
- **THEN** each fake LiteLLM endpoint accepts at least one authenticated discovery request using only its expected key

### Requirement: diagnostics endpoint arguments follow the OpenCode command invocation contract
In explicit multi-endpoint mode, the plugin SHALL read the slash-command tail from the OpenCode command invocation and SHALL scope diagnostics to the requested endpoint when a valid endpoint id is supplied.

#### Scenario: user requests one endpoint's diagnostics
- **WHEN** the user executes `/litellm-diagnostics company`
- **THEN** the command reads `company` from the invocation prompt text
- **AND** the diagnostics result starts with `Endpoint：company`
- **AND** the result contains the selected endpoint's detailed diagnostics rather than the multi-endpoint overview

#### Scenario: endpoint argument contains surrounding whitespace
- **WHEN** the command invocation prompt text contains surrounding whitespace around a valid endpoint id
- **THEN** the plugin trims the whitespace before endpoint lookup

#### Scenario: endpoint argument is unknown
- **WHEN** the user supplies an endpoint id that is not configured
- **THEN** diagnostics reports that exact endpoint id as unknown instead of silently falling back to the overview

### Requirement: Global endpoint registry
The plugin SHALL support a global `endpoints` object keyed by stable user-defined endpoint ids and SHALL NOT require project-level endpoint configuration.

#### Scenario: Multiple endpoints are configured
- **WHEN** the global configuration defines `default` and another endpoint
- **THEN** the plugin exposes independent provider identities for both endpoints

### Requirement: Legacy zero-migration behavior
The plugin SHALL map the historical single-endpoint configuration to endpoint `default` and preserve the historical provider, credential and snapshot identity.

#### Scenario: Existing user upgrades
- **WHEN** no explicit `endpoints` object is configured
- **THEN** the legacy LiteLLM setup continues to operate as `default` without a migration step

### Requirement: Independent activation
The plugin SHALL persist activation separately from endpoint definitions and SHALL support all endpoints, an arbitrary selected set, or zero active endpoints.

#### Scenario: Endpoint is deactivated
- **WHEN** a user deactivates one endpoint
- **THEN** that endpoint stops provider registration and discovery without deleting its definition, credential or snapshot

### Requirement: Endpoint isolation
Each endpoint SHALL have independent credentials, discovery coordination, cache, snapshot, diagnostics and failure behavior.

#### Scenario: One endpoint fails
- **WHEN** one active endpoint has an authentication or transport failure
- **THEN** other active endpoints continue using their own state and are not failed over or merged automatically

### Requirement: Endpoint management targets the current session location

The plugin SHALL route endpoint management RPCs, integration credential queries/connections and endpoint result polling to the current TUI session location. Existing OpenCode location runtimes MUST reconcile persisted activation before returning refreshed endpoint management state.

#### Scenario: [ACT-LOCATION] Enable an endpoint from a non-default session location

- **GIVEN** 一个 session 的目录与 server 默认目录不同，company 已保存凭据但未启用
- **WHEN** 用户通过该 session 的 `/litellm-endpoints` 启用 company
- **THEN** 管理 RPC 使用当前 session location
- **AND** 该位置的模型列表包含 company 模型，另一个已启用 endpoint 仍存在
- **AND** 轮询与切换 session 后的请求使用对应的当前 location

#### Scenario: [ACT-LOCATION-REFRESH] Existing location refreshes shared activation

- **GIVEN** 两个已启动 location runtime 共享同一份持久化 activation
- **WHEN** 一个位置启用或停用 company，另一个位置刷新 endpoint 管理状态
- **THEN** 后者重新读取已保存 activation 并协调自己的 provider/discovery
- **AND** 状态与模型发布对应启用/停用结果，不恢复旧的本地期望值

### Requirement: Re-enabled endpoints publish validated cached models consistently

The plugin SHALL reload the host provider when a restored endpoint first becomes applied after network validation, even if its model fingerprint is unchanged. Activation reconciliation, persisted-state refresh and runtime rebuild MUST complete in order so an older deactivation cannot overwrite a newer enabled endpoint state.

#### Scenario: [ACT-CACHED-RESTORE] Re-enable an endpoint with unchanged cached models

- **GIVEN** 一个已保存凭据和可信模型快照的 endpoint 当前停用
- **WHEN** 用户启用它，网络确认的模型与快照完全相同
- **THEN** 宿主 provider 重新发布这些模型
- **AND** 管理状态显示已启用且已生效，模型列表实际包含这些模型

#### Scenario: [ACT-RECONCILE-ORDER] Enable while previous deactivation is still cleaning up

- **GIVEN** 后台状态刷新正在停用 endpoint，其旧 provider 清理尚未完成
- **WHEN** 用户重新启用该 endpoint
- **THEN** 旧清理先完成，再执行新启用
- **AND** 管理状态、期望启用集合和宿主模型最终一致，不被旧清理覆盖

### Requirement: Overlapping activation updates preserve earlier changes

The plugin MUST serialize reading the current activation, computing the requested change, persisting it and reconciling the runtime in the same operation.

#### Scenario: [ACT-CONCURRENT-TOGGLES] Enable different endpoints concurrently

- **GIVEN** company 和 personal 均已配置凭据且全部停用
- **WHEN** 两个启用 toggle 请求重叠执行
- **THEN** 两个 endpoint 均被保留在持久化启用集合中
- **AND** 管理状态均为期望启用，二者的 provider 模型均被发布
