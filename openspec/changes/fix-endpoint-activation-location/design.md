## Context

OpenCode 2.0.16 的 provider/plugin runtime 按 location 隔离，KV activation 全局共享。TUI 模型选择器按 location.ref 查询模型，而插件管理请求缺少 location，且每个 runtime 的 activation 只在 setup 时读取。

## Goals / Non-Goals

保证当前会话的启用操作协调其实际 provider runtime；管理刷新反映共享已保存状态。不增加跨进程通知服务、不改 Core、不改 endpoint 定义或发现规则。

## Decisions

1. 在每次请求时读取 TUI context.location，包括 endpoint 所有 RPC、integration 查询/连接和 endpoint/audit 恢复轮询；切换会话不沿用旧位置。
2. manager.refresh 在返回视图前调用宿主 activation 同步。保存值变化才 reconcile；读失败保留当前期望值，迟到读取不覆盖已发生的本地变更。
3. 写 activation 成功后才更新本地值，保持持久化与运行期的一致性。复用现有 runtime.reconcile，不引入第二套 provider 状态。
4. 发现、失败降级、缓存与刷新周期不变；只在 activation 变化时启动/停止既有 endpoint loop。

## Compatibility

现有 canonical 多 endpoint 规格和固定 LiteLLM fixtures 保持；补充位置路由与跨实例刷新场景。location 为宿主已有可选字段；未提供时保留默认目录行为。dist 按现有 provenance 固定 SHA 重建，不更新 Core。

## Validation

- [ACT-LOCATION] 单元回归先在旧实现失败，覆盖当前位置、切换位置及启用请求。
- [ACT-LOCATION-REFRESH] 共享 storage 的两个独立 runtime，检查真实 Core fixtures 经 provider transform 发布模型、状态与停用收敛。
- Real OpenCode 2.0.16 与用户实际使用的 2.0.30：固定 Git 包安装，隔离 HOME/XDG、本地 fake LiteLLM、非默认目录 session 的真实键盘启用和模型列表；原有完整真实宿主门禁继续运行。
