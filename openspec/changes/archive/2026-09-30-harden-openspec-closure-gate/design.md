# Design

## 边界

这是 Pi/OpenCode 的维护者与 CI governance tooling，不改变宿主 API、discovery、endpoint、model、runtime、dist 与 provenance。Core 的 `docs/testing-standard.md` 是共享原则真源；本仓库只实现独立可运行的 adapter-side gate。

## OpenSpec 1.13.2 语义调查

固定 CLI 为 `@fission-ai/openspec@1.13.2`。`openspec archive` 会把 `changes/<id>/specs/**/spec.md` 的 delta 合并到同一相对 capability 的 canonical spec，并把完成的 change 目录移动到 archive；archive 仍保留 delta、tasks、proposal、design 与 metadata。CLI 的 Markdown parser 属于内部实现，脚本只实现其稳定 grammar 的最小语义读取，避免依赖 CLI 私有模块或 workspace 目录。

本次 review 进一步核实官方 grammar 的明确语义（`dist/core/specs-apply.js` 与 `dist/core/validation/validator.js`）：一个 delta 内的 apply 顺序固定为 RENAMED → REMOVED → MODIFIED → ADDED（RENAMED 多对 FROM/TO 按文件顺序）；同一 delta 对同一 requirement name 的冲突 transition 被 validation 明确拒绝；REMOVED 只删除 block，之后的 change 可以再次 ADDED 同名 requirement；RENAMED 的 apply 语义是“源存在则迁移、源消失但目标存在视为已同步、两者都不存在报错”。

## 语义与兼容

- 忽略 Markdown whitespace、requirement 顺序与 scenario 顺序，比较 statement/scenario 语义。
- ADDED/MODIFIED 必须有 statement 与 scenario；REMOVED 支持 names-only；RENAMED 支持 FROM/TO。
- requirement 历史是 state machine replay：对每个 identity 把 ADDED/MODIFIED/REMOVED/RENAMED 全部当作状态转移，在 `ABSENT` 与 `PRESENT(title, semantics)` 之间回放并得出唯一终态；REMOVED 不是脱离 chronology 的布尔值，RENAMED 不取数组最后一项，终态是“整个可证明 chronology 下的最终 operation/state”而不是“最后一个带 body 的状态”。
- 终态 PRESENT 要求 canonical 存在该标题且语义一致；终态 ABSENT 要求 canonical 不存在该 identity 的任何历史标题。
- archive chronology 是 Git ancestry 导出的 partial order（`before/after/same/incomparable/unknown`），不是全局 total order：同一 introduction commit 是 tie，互非 ancestor 是 incomparable，Git 历史不完整或不可用是 unknown；绝不用 archive 名、lexical order、文件系统顺序、数组顺序或 timestamp 破 tie。
- 只有当同一 identity 的所有可证明线性扩展收敛到同一终态才接受；否则输出 `ambiguous archived requirement history` 并 fail closed。tie 且状态等价可以 PASS，但不计为 ancestry-resolved。
- 测试注入 `OPENSPEC_CLOSURE_ORDER_JSON` 表达 partial order（`groups` 有序 layer、layer 内无顺序、`edges` 显式 before 边），可表达 tie 与 incomparable；非法 fixture fail closed。
- 同一 delta 内按 OpenSpec apply 顺序回放；grammar 拒绝的同名冲突 transition 在本 gate 同样 fail closed（malformed）。
- 历史的 root `spec.md` 明确作为 informational legacy artifact 报告；无 delta 的 archive 只有带 `skip_specs: true` 才可通过。
- 运行 closure gate 的 workflow job 必须 `fetch-depth: 0`（chronology 来自 Git ancestry），并由静态回归测试守护。
- 脚本与 fixture 在本仓库内维护，独立 clone 后不读取 `../litellm-provider`、core 或任何 sibling repository。

## README

No README change: no user-visible behavior.
