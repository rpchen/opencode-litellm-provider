## Why

已建立的代码图谱需要在日常跨会话任务中自动发现并使用，同时随每个 Release 生成绑定不可变源码提交的可验证快照，使本地缓存和云端发布附件能够在下次在线启动时同步，避免图谱与当前源码或发布版本混淆。

## What Changes

保留显式索引选择；加入 tag SHA 绑定的图谱附件和本地同步工具，不改变 discovery、凭据、宿主 API 或 dist。

## Capabilities

### New Capabilities
- `codebase-memory`：索引选择、发布身份与本地同步边界。

### Modified Capabilities

无。

## Impact

影响本仓库开发工具、CI/Release 和开发文档，不增加产品运行时依赖。无 OpenCode ctx/hook 或 Pi ExtensionAPI 变更。相关独立 PR：Core #24、OpenCode #51、Pi #43、workspace #1；本次没有 Core 公共 API 变化，可独立合入。
