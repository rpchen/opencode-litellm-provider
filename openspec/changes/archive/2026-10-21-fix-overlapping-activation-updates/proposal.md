## Why

PR #69 的审核在 `86f2f7c` 复现：全部停用时重叠切换 company 和 personal，后一个请求使用入队前的旧 activation 覆盖前一个启用结果。已有队列只包含写入与协调，未包含读取和计算。

## What Changes

- 将 activation 读取、集合计算、持久化和运行时协调置于同一串行操作。
- 使用现有固定 discovery fixture 补充双 endpoint 重叠请求回归，核对持久化、管理状态及模型发布。

## Capabilities

### Modified Capabilities

- `multi-endpoint-activation`：重叠启停请求保留此前已完成请求的更新。

## Impact

仅修改 OpenCode adapter 内部的 activation 更新回调与测试、固定 dist；保留 `ctx.rpc` / `ctx.storage` / `ctx.provider` 的现有 API 和 experimental 依赖面。不修改共享 Core、协议、网络缓存策略或发行版本。
