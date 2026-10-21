## Context

`setActivation(next)` 的写入与 reconcile 已串行，但 RPC 在调用前读取旧状态并生成 next，两个重叠 toggle 会丢失第一次更新。

## Decisions

RPC 提交一个以当前 activation 为输入的同步更新函数。宿主在已有 runtime 队列内调用该函数，然后持久化、更新本地状态并协调 runtime。管理中心的明确集合写入继续复用同一入口。未知 endpoint 的 toggle 保持无操作。

## Behavior baseline

与现有规格和 fixtures 的差异仅为纠正重叠更新丢失；顺序操作、location 路由、缓存重新发布均沿用原行为。网络失败降级、缓存及刷新触发方式不变。

## Validation

先用固定 `/v1/model/info` discovery fixture 复现两个 endpoint 同时启用只保留后者；修复后验证二者的持久化、canonical desired 状态与真实 adapter provider 模型。执行固定 provenance 构建及独立 `verify:dist`，不更新 Core。真实宿主由 CI 用不可变 Git commit、隔离 HOME/XDG 和本地 fake LiteLLM 验证 OpenCode 2.0.16 与 2.0.30；不使用用户配置或真实密钥。
