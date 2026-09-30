# Harden OpenSpec Closure Gate

## Why

现有 `test:openspec-closure` 只拒绝 completed change 留在 active changes，不能发现 archive delta 未同步到 canonical specs 的 false closure。维护者因此可能在 strict validation 与 CI 绿色时仍发布 canonical specification drift。

## What Changes

- 保留 active completed change 检查。
- 对 archived OpenSpec delta 做 capability、requirement、scenario、operation 语义核对。
- 对 ADDED、MODIFIED、REMOVED 和 malformed archive 提供失败回归与 actionable diagnostics。
- 三个独立仓库使用同构、可独立 clone 运行的治理脚本，不引入 workspace 平级目录依赖。
