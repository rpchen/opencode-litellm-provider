# Design

## 边界

这是 Pi/OpenCode 的维护者与 CI governance tooling，不改变宿主 API、discovery、endpoint、model、runtime、dist 或 provenance。Core 的 `docs/testing-standard.md` 是共享原则真源；本仓库只实现独立可运行的 adapter-side gate。

## OpenSpec 1.13.2 语义调查

固定 CLI 为 `@fission-ai/openspec@1.13.2`。`openspec archive` 会把 `changes/<id>/specs/**/spec.md` 的 delta 合并到同一相对 capability 的 canonical spec，并把完整 change 目录移动到 archive；archive 仍保留 delta、tasks、proposal、design 与 metadata。CLI 的 Markdown parser 属于内部实现，脚本只实现其稳定 grammar 的最小语义读取，避免依赖 CLI 私有模块或 workspace 目录。

## 语义与兼容

- 忽略 Markdown whitespace、requirement 顺序和 scenario 顺序，比较 statement/scenario 语义。
- ADDED/MODIFIED 必须有 statement 与 scenario；REMOVED 支持 names-only；RENAMED 支持 FROM/TO。
- 同一 capability 的多次历史 archive 不假定同日目录有可恢复的提交顺序；canonical 必须匹配 archived history 可证明的最终语义。
- 历史旧 root `spec.md` 明确作为 informational legacy artifact 报告；无 delta 的 archive 只有带 `skip_specs: true` 才可通过。
- 脚本与 fixture 在本仓库内维护，独立 clone 后不读取 `../litellm-provider`、core 或任何 sibling repository。

## README

No README change: no user-visible behavior.
