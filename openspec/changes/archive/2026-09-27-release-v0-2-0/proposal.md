## Why

共享 core 迁移 PR #19 已合并，维护者在 Windows / OpenCode 2.0.16 确認实际加载 d565084 后反馈模型列表、推理档位、实际对话和审计导出正常。需要以 v0.2.0 标记这一已验证构建，供固定版本安装与回滚使用，而不是继续让 package version 与旧 v0.1.4 混淆。

## What Changes

- 将 manifest、lockfile 顶层及根包版本统一为 0.2.0；不更新任何依赖解析或已验证 dist/core provenance。
- 记录维护者实测反馈、发行说明和旧 tag 到 main / 新 tag 的升级方式。
- 现有 Release workflow 增加只接受既有版本 tag 的 workflow_dispatch 入口，沿用全部固定产物验证；补充根版本一致性检查与附件下载复核。
- 先经 PR / CI / main CI，再创建 v0.2.0 tag，由同一 Release workflow 发布 .tgz 和 SHA-256。既有 tag 不移动，不发布 npm。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `distribution`：版本元数据一致性、固定 tag 的显式发布入口及发布附件复核。

## Impact

仅修改 rpchen/opencode-litellm-provider 的发行元数据、开发期检查、CI 入口和文档。OpenCode 的 ctx / hook / server / TUI 依赖面不变，不新增 experimental API，不修改插件业务逻辑或宿主 SDK，不修改 Pi / core。当前编辑终端没有 Bun/gh 且无法解析 GitHub/npm；使用已认证连接与 GitHub Actions 执行，所有验收按实际执行位置记录。
