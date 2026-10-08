# Delta: publication

## ADDED Requirements

### Requirement: LKG 以 schema 8 同 resolution 派生

扩展 SHALL 在 seeding 时把 live catalog 与 options 透传给 Core，使 LKG 条目由
通过 gate 的同一 resolution 派生（`PUBLICATION_SCHEMA_VERSION = 8` 的
group-wide proof composition）；seeding 保持 best-effort。内存中已存在的 v7
及更早条目 SHALL 被 Core 判不兼容（fail closed），下一轮 live 自动重捕获为
v8。OpenCode 不复制 proof 判定、不持久化 LKG 条目。

#### Scenario: seeding 产出 v8 条目

- **WHEN** 某模型本轮 `configured` 且 Core 为 schema 8
- **THEN** store 中的条目 `schemaVersion` 为 8 且对未变更的 live 输入验证通过

#### Scenario: 旧条目 fail closed 后重捕获

- **WHEN** store 中存在 v7 条目且 catalog 中断
- **THEN** 本轮不恢复该条目；catalog 恢复后的首轮 live 自动捕获 v8 条目
