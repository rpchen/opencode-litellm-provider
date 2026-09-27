## Why

OpenCode 与 Pi 重复维护宿主无关的 LiteLLM 发现逻辑，容易出现协议、元数据及推理规则漂移。共享 core 已在独立仓库交付，本变更落实迁移计划 PR3，仅修改 OpenCode 仓库。

## What Changes

- 删除受 Git 管理的 `src/core` 实现，构建时通过独立 core 的公共 `src/index.ts` 消费同一完整 commit SHA 的源码。
- 在 OpenCode 适配层保留 `package` 和协议 SDK 映射；保持插件入口、注册、连接、网络、轮询、降级、审计及推理行为不变。
- 区分显式跟随 core/main 的更新构建与按已提交 provenance SHA 的固定复验；提交 dist、许可证和 provenance。
- CI/Release 在独立目录重建并比较实际待交付产物，不先覆盖 dist；补充缓存完整性、产物篡改和外部消费者验证。

## Capabilities

### New Capabilities
- `shared-discovery-core`: 独立 core 的来源、宿主边界、固定 SHA 构建、不可变复验及离线安装契约。

### Modified Capabilities

- `distribution`: 已提交产物按 provenance 的固定 SHA 在独立目录复验；外部消费者验证真实安装入口与初始化契约。

现有发现、协议、能力、推理、刷新和审计能力的业务要求不变。

## Impact

仅影响本仓库的源码来源、适配层、开发构建、交付验证和文档。仍使用 `src/index.ts` / `src/tui.ts`、TypeScript ESM 编译及既有 dist 入口；不新增运行时 core 依赖或生命周期脚本。

宿主 API 依赖面保持原样：`ctx.integration`、`ctx.provider`、连接/生命周期事件、命令、RPC 和 TUI 注册。既有 v2 experimental 接口的风险不扩大。本次不修改 Pi/core，不实现跨仓库触发，不合并、不打 tag、不创建 Release、不发布 npm。
