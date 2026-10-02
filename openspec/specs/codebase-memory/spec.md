# codebase-memory Specification

## Purpose
规定已经由用户显式选择的 Git 仓库如何在日常编码会话中使用代码图谱，如何为不可变 Release tag 生成具有源码身份和完整性校验的发布附件，以及客户端下次在线启动时如何同步发布快照并保护当前工作区。

## Requirements

### Requirement: explicit indexing controls graph adoption
系统 SHALL 只为已存在索引选择标记的最近 Git 仓库自动刷新；新仓库索引由用户显式选择。

#### Scenario: [CBM-OPT-IN] unindexed child does not inherit parent graph
- **WHEN** 当前 Git 仓库不存在 `.codebase-memory/artifact.json`
- **THEN** 自动刷新 SHALL 跳过该仓库，不触发 index_repository

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

### Requirement: local release snapshots preserve working checkout
客户端启动 SHALL 对已索引仓库同步最新已发布快照，并保持当前源码、分支和 tag 不变；本地工作图谱单独按当前源码刷新。

#### Scenario: [CBM-SYNC] startup sync handles released and working commits independently
- **WHEN** 当前检出 commit 与最新 Release 不同，或重复启动、离线、Release 缺少附件
- **THEN** 下载 SHALL 校验远端 tag SHA 并单独缓存；重复启动复用已校验快照；失败保留既有数据，不能覆盖工作区或自动建新索引
