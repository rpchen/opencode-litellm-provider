## MODIFIED Requirements

### Requirement: release snapshots bind immutable source identity
系统 SHALL 使用固定工具版本从干净的对应 tag commit 生成可验证索引，作为 Release 附件分发。

#### Scenario: [CBM-RELEASE] indexed release publishes a complete snapshot
- **WHEN** HEAD 等于版本 tag 且源码干净
- **THEN** 图谱、原生元数据和包含仓库/tag/commit/SHA-256 的 manifest SHALL 生成并通过校验

#### Scenario: [CBM-FAIL-CLOSED] invalid source or runtime prevents publication
- **WHEN** 源码脏、tag 不匹配、工具版本不匹配或索引生成失败
- **THEN** 构建 SHALL 失败，不能输出可发布的完整 manifest

#### Scenario: [CBM-INTEGRITY] corrupted or mismatched snapshot is rejected
- **WHEN** 图谱损坏、SHA-256/schema 或仓库/tag/commit/project 身份不一致
- **THEN** 校验 SHALL 拒绝该快照

#### Scenario: [CBM-DEGRADED] non-success native indexing prevents export
- **WHEN** 原生返回 degraded、未知、缺失或其他非 indexed 状态，即使后续 status 为 ready 且存在少量节点
- **THEN** 构建 SHALL 失败，不能输出发布 manifest
