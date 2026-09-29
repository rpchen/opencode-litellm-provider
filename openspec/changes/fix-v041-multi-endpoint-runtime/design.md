# Design

## 正确运行时模型

OpenCode V2 的 `ctx.plugin` 只用于读取当前 plugin 列表，不提供运行时 `add/remove`。多 endpoint 因此不能通过动态 child plugin 实现。

显式多 endpoint 改为单 plugin context：

1. 启动时为全部已配置 endpoint 注册 integration transform。
2. 每个 endpoint 使用稳定 integration id：`default -> litellm`，其余为 `litellm-<id>`。
3. OpenCode 的 integration editor `update()` 可创建尚不存在的 integration；`method.update()` 为各 integration 注册独立 key 方法。
4. activation 仅控制 endpoint 对应 provider transform、discovery loop 和发布状态；integration 始终保留，使停用 endpoint 的 credential 仍可通过宿主管理。
5. discovery 继续通过 `integration.connection.active(endpoint.integrationId)` / `resolve()` 获取该 endpoint 独立 credential。

## UI 与命令

现有命令输出链路继续使用 server RPC event → 自动加载的 `./tui` entrypoint → `session.composer.top` 卡片。本次不改变 UI 交互形态，但补显式 multi-endpoint server setup 与 TUI 可见输出的纵向验收，确保 server plugin 不再因错误 API 失败。

## 与 v0.4.0 行为基线的差异

- 动态 child plugin → 单 plugin context 多 integration/provider：因为前者不是 OpenCode V2 公共 API。
- 停用 endpoint 时 integration 不再被卸载：credential 仍由 OpenCode 独立保存，activation 只控制 provider/discovery，符合“不删除 credential”的既定语义。
- 用户配置格式、provider/integration id、snapshot identity、activation 持久化格式均不变。

## 失败与清理

- 任一 active endpoint runtime 在初始 reconcile 失败时，已启动 endpoint runtime 和 integration registration 全部清理后再抛错。
- plugin cleanup 先停止 command/RPC，再停止所有 endpoint runtime，最后释放共享 integration transform。
- 不改变 LiteLLM 网络失败降级、cache 或 refresh coordinator 策略。