## Context

本 change 处理本轮七类审核问题。

## Decisions

安全协议、失败语义、来源兼容、缓存竞争、MCP 实际门禁和文档边界均见 docs/codebase-memory.md 的“本轮审核后的同步安全边界”。固定源码使用隔离 checkout；发布按 SHA 隔离且 ref 只 CAS/fast-forward；多仓不改仓库合并或保护策略。源码修改不在工作图谱快照中冒充干净 commit。

## Verification

共享 codebase-memory-main.test.mjs 用真实 bare remote/checkout/branch/ref/files/staging；Git API fixture 实际写 Git 对象。Workspace codebase-memory-client.test.mjs 覆盖实际原生 stdio 门禁和 metadata/回执齐全。旧提交以仅 I/O 适配重放相同断言。Scenario 证据见 tasks；产品 LiteLLM fixtures、宿主 provider/UI/Core 语义未触及，原 CI 与真实宿主 E2E 继续运行。
