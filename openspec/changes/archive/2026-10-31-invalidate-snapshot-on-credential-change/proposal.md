# Why

凭据变化时模型已清空，但旧快照状态未清除，导致网络失败后界面仍声称使用失效快照，需让模型发布与状态同步。

# What Changes

- 清空失效快照模型时重置 applied。
- 回归覆盖同一连接更换 Key 后发现失败。

# Capabilities

## Modified Capabilities
- discovery-snapshot: 凭据变化后的快照失效状态。

# Impact

src/host/sync.ts、test/sync.test.ts 及构建产物。
