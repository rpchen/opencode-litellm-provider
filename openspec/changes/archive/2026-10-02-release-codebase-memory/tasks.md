## 1. 实施

- [x] 1.1 保留显式索引选择，添加独立发布/同步工具与负向测试
- [x] 1.2 将生成与发布后回读验证加入 Release 流程
- [x] 1.3 更新 README、AGENTS 与开发文档

## 2. 证据

- [x] 2.1 执行 test:codebase-memory：每个 CBM Scenario 对应 scripts/codebase-memory.test.mjs 同名标签测试
- [x] 2.2 执行本仓库完整提交前门禁（含现有 /v1/model/info 固定样本测试）与 strict OpenSpec validation
- [x] 2.3 完成 CLI archive、再次 strict validation；PR CI 与实际 Release 执行单独在 PR 中报告

## 已执行证据

- 每个 CBM Scenario 在 scripts/codebase-memory.test.mjs 有同名标签，5/5 通过；包含脏源码、错误 tag/version、索引失败、损坏资产和 schema/身份不符、离线/缺附件与重复同步输入。
- 原生 0.11.0 在隔离 Git fixture 的 v1.2.3 上实际生成 5 节点、3960 字节 zstd 图谱，manifest 与 tag commit 一致并通过校验；fixture 已清理，产品仓库没有创建 tag 或 Release。
- 本仓库 typecheck、单元测试（含脱敏 /v1/model/info fixture）、适用的构建/固定 dist 复验、隔离 package 与 closure 门禁已通过；两个插件另通过 release metadata 门禁。OpenCode 首次运行有既有 5 秒 timeout，独立重跑 257/257 通过，未修改该测试。
- 本变更不修改 discovery、宿主契约或 dist/provenance；真实宿主 E2E 继续由既有 PR CI 验证。
