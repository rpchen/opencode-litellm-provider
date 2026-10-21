## Why

真实 OpenCode 2.0.16 为不同目录维护独立插件实例。现有 TUI endpoint RPC 未传当前 location，可能修改默认目录实例，而模型选择器和诊断读取会话所在实例；已启动实例也只在启动时读取持久化 activation。实测两个目录初始均停用 company，在一个目录启用后，另一个仍报告停用。

## What Changes

- endpoint 管理、凭据 integration 查询/连接和结果轮询明确使用当前会话 location。
- 管理状态刷新重新读取共享 activation，仅在变化时协调当前实例的 provider/discovery。
- 增加跨目录真实宿主及单元回归，检查启用、模型发布和停用收敛。

## Capabilities

### Modified Capabilities

- `multi-endpoint-activation`: 会话位置正确的管理请求与已有实例的 activation 刷新。

## Impact

只修改 OpenCode adapter 的 ctx.storage、provider、RPC、TUI client 边界；不改变 Core、Pi、配置格式或凭据存储。继续使用已支持的 location/RPC 参数，无新增 experimental API。
