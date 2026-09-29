# 修复 OpenCode 多 endpoint 运行时

## Why

v0.4.0 在显式多 endpoint 模式中尝试调用不存在的 `context.plugin.add/remove`，导致 OpenCode V2 server plugin 初始化失败。与此同时，用户无法可靠地通过 `/connect` 为每个 endpoint 使用独立 integration credential，依赖 server RPC 的 diagnostics / endpoints / audit TUI 输出链路也因 server plugin 进入 failed 状态而不可用。

## What Changes

- 移除对不存在的动态 child-plugin API 的依赖。
- 在单一 OpenCode V2 plugin context 中一次注册所有 endpoint integration，并按 activation 独立启停 provider/discovery runtime。
- 保持每个 endpoint 的 integration id、credential、provider、discovery、snapshot 与故障域隔离。
- 明确 `/connect` 按 endpoint integration 独立保存 API Key 的用户流程。
- 增加真实 V2 context 形状回归：显式多 endpoint setup 不提供 `plugin.add/remove` 也必须成功。
- 增加 installed-package / TUI 纵向验证，防止 server failed 时命令无输出的问题再次漏过。

## OpenCode V2 API 依赖面

本修复只使用公开稳定域：`ctx.integration.transform/connection`、`ctx.provider.transform/reload`、`ctx.storage`、`ctx.rpc`、`ctx.command`、`ctx.event`。不使用 experimental API，也不再假设 `ctx.plugin` 可以动态增删插件。