## ADDED Requirements

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
