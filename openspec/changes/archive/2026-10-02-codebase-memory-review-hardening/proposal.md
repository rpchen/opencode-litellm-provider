## Why

第三方审核发现发布构建接受原生 degraded 返回；后续 ready 只代表存在节点，无法证明本轮索引成功。工作图谱也不能复用其他机器的快照名称作为本地数据库身份。

## What Changes

- 本仓库独立发布工具只接受 index_repository 明确 indexed 状态；structuredContent 和 content/text 两种返回均解析，其他或缺失状态失败。
- 工作刷新不传 name override，按本机规范化 Git 根目录使用原生项目身份。
- 增加降级与未知状态负向回归，保留原有发布/完整性/离线测试。

## Capabilities

### Modified Capabilities
- codebase-memory: 发布索引拒绝降级状态。

## Impact

仅涉及 scripts/codebase-memory.mjs、对应测试和开发文档。四仓库工具副本同步修复；工作区 PR #1 另修客户端 watcher、JSONC 迁移和备份。关联 Core #24、OpenCode #51、Pi #43；无业务 API、运行时依赖、dist、provenance 或版本变化，可独立合入。
