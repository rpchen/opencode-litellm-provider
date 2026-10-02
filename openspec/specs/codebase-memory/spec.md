# codebase-memory Specification

## Purpose
规定显式选择仓库的每个合并 main SHA 如何发布长期、不可变且可回读校验的索引，四客户端如何在每个新任务准备最新代码与索引，并在授权合并后验证本地与远端快照字节一致；保留不可变 Release tag 的独立附件与未完成工作保护。

## Requirements

### Requirement: explicit indexing controls graph adoption
系统 SHALL 仅为最近 Git 根中有显式 selection.json 或旧 artifact.json 的仓库自动准备索引；新仓库须用户明确选择。

#### Scenario: [CBM-OPT-IN] unindexed child does not inherit parent graph
- **WHEN** 最近 Git 根既无 selection.json 又无 artifact.json
- **THEN** 自动准备 SHALL 跳过，不调用 index_repository，也不继承父仓库图谱

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
Release 下载阶段 SHALL 仅校验并单独缓存 tag 快照，不改变源码或分支；它 SHALL 不被用于冒充最新 main。

#### Scenario: [CBM-SYNC] startup sync handles released and working commits independently
- **WHEN** Release 与当前代码不同，重复启动、离线或旧 Release 缺少附件
- **THEN** Release 下载 SHALL 保留 checkout；新任务另行验证准确 main SHA 的共享索引

### Requirement: merged main snapshots bind reviewed source
完整 main CI 成功后系统 SHALL 从准确 SHA 的干净源码生成索引，以固定原生版本和明确 indexed 状态发布到专用索引分支的不可变 SHA 目录。

#### Scenario: [CBM-MAIN-PUBLISH] successful main CI publishes exact merge snapshot
- **WHEN** 准确 main SHA 的完整 CI 成功
- **THEN** 图谱、原生 metadata 与 repository/commit/tree/SHA-256 manifest SHALL 发布并回读验证；索引提交不写 source main

#### Scenario: [CBM-MAIN-IMMUTABLE] retries preserve the original snapshot
- **WHEN** 同 SHA 已存在或两个 publisher 并发
- **THEN** 发布 SHALL 复用已验证快照或重试 fast-forward，不覆盖原快照或强推索引分支

### Requirement: every new task synchronizes code and index
新任务 SHALL 在任一客户端先 fetch 最新 main，取得准确 SHA 的已验证共享快照，安全同步源码并激活本机工作图谱，ready 后才开始实施。复用 MCP 连接 SHALL 不豁免准备。

#### Scenario: [CBM-TASK-START] clean checkout starts with current remote source and index
- **WHEN** 新任务在已选择的干净 main 或已合并分支开始
- **THEN** prepare SHALL 返回最新 main SHA、对应远端快照和本机可用 project，Git 源码保持干净

#### Scenario: [CBM-PRESERVE-WORK] unfinished work blocks a new task
- **WHEN** 有未提交源码、未合并分支、本地 main 独有提交或其他 worktree 占用
- **THEN** new/finish SHALL 失败并保留工作；仅显式 resume 可继续旧任务，不自动 stash/reset/clean

#### Scenario: [CBM-TASK-PENDING] unavailable or invalid remote index is not ready
- **WHEN** 离线、发布 pending、身份或校验不符
- **THEN** prepare SHALL 不返回 ready，也不把旧索引当最新

### Requirement: merge completion includes index agreement
授权合并后的任务 SHALL 在准确 main CI 和索引发布成功后执行 finish，回最新 main 并校验本地不可变快照与远端三文件全部字节一致；PR merged 本身 SHALL 不算收尾完成。

#### Scenario: [CBM-TASK-FINISH] merging client verifies identical local and remote snapshot
- **WHEN** PR 已授权合并且快照发布完成
- **THEN** finish SHALL 返回 main SHA、原生 project/root 和匹配的快照校验值；用户无需手工拉取或提交工作索引
