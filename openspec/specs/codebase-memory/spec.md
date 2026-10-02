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

### Requirement: task readiness verifies final remote main
prepare 和 finish SHALL 在等待、下载校验后及返回前重新核验远端 main。目标变化 SHALL 在同一总超时预算内重定向；ready SHALL 记录最终核验时刻、实际分支和一致的 code/index SHA、tree 与三文件校验和。底层子进程超时 SHALL 抛出携带稳定 ETIMEDOUT 错误码的错误；预算回归 SHALL 断言稳定语义，不依赖偶发英文文案。

#### Scenario: [CBM-RETARGET] main advances while prepare or finish waits
- **WHEN** 开始目标 A 的索引等待或下载期间 main 前进为 B
- **THEN** SHALL 获取 B 的准确索引，实际 checkout 与 code/index SHA 同为 B，不声明 A 是最新

#### Scenario: [CBM-TOTAL-BUDGET] repeated target changes cannot restart timeout
- **WHEN** 多次 main 前进或索引发布缺失耗尽最初的总等待预算
- **THEN** SHALL 以稳定超时语义失败而不返回 ready

#### Scenario: [CBM-WORKSPACE-BUDGET] workspace budget expires before the next selected root
- **WHEN** 前一个已选仓库耗尽正数等待预算
- **THEN** 整体 SHALL 失败，不将剩余预算变成无等待上限的零值尝试

#### Scenario: [CBM-NOT-READY] invalid or unavailable service blocks readiness
- **WHEN** 索引缺失、校验失败、网络失败或等待超时
- **THEN** SHALL 保留工作且不写入本次成功 ready 回执

### Requirement: synchronization protects actual symbolic Git state
同步 SHALL 使用 Git common dir 互斥、分支/HEAD/main ref/工作区状态保护及旧 OID CAS；每次 Git 修改前重新核验，返回前读取实际分支和提交，不硬编码成功。不得强制切换、reset、clean 或 stash 用户工作。排队客户端 SHALL 只在锁前读取定位锁所需的稳定路径信息；分支、HEAD、tree 与工作区状态 SHALL 在获锁后重新读取并验证。前一个排队任务合法推进 checkout 与回执后，后续任务 SHALL 接受该新状态继续准备；真实用户并发修改仍 SHALL 安全拒绝。ready 回执 SHALL 仅在准备失败时失效，排队任务不得误删前一任务刚生成的有效回执。

#### Scenario: [CBM-CONCURRENT-CHECKOUT] same SHA branch or source changes during download
- **WHEN** 其他进程切到同 SHA 新分支，或产生 tracked/untracked/staged 修改、新提交
- **THEN** SHALL 安全失败并保留分支、main ref、源码字节和暂存内容

#### Scenario: [CBM-COMMON-MUTEX] linked worktrees prepare concurrently
- **WHEN** 一个工作树的客户端正在下载索引而另一个工作树开始准备
- **THEN** 两者 SHALL 使用同一 common Git 锁；后者等待超时失败而不改变分支或源码

#### Scenario: [CBM-PRESERVE-WORK] existing unfinished source remains intact
- **WHEN** 已有未完成分支、本地独有提交、修改或暂存内容
- **THEN** new/finish SHALL 失败且原状态不丢失，只有显式 resume 可继续旧工作

#### Scenario: [CBM-QUEUED-LOCK] a queued second client accepts the advanced checkout
- **WHEN** 两个独立客户端进程在同一 checkout 上排队获锁，第一个推进 main 到 B 并写入有效 ready 回执，第二个持锁前旧状态获锁
- **THEN** 第二个 SHALL 在锁内重读并验证实际状态，成功准备 B，且前一任务的有效回执保留

#### Scenario: [CBM-QUEUED-USER-CHANGE] a queued client rejects concurrent user changes
- **WHEN** 排队客户端获锁前真实用户产生未提交修改
- **THEN** SHALL 安全失败并保留用户修改与分支状态，不返回 ready

### Requirement: publication scheduling isolates source commits
生成任务 SHALL 按完整 source SHA 隔离排队，不让较旧 CI 替换另一 SHA 的 pending 发布；共享分支追加 SHALL 处理 ref 冲突、退避重试和同 SHA 幂等，不得强推。

#### Scenario: [CBM-SHA-QUEUE] old CI arrives after latest main publisher is pending
- **WHEN** 一个发布任务在运行、B 的任务等待、旧 A 的 CI 随后完成
- **THEN** A 与 B SHALL 属于不同 concurrency group，B 不因此被取消

#### Scenario: [CBM-PUBLISH-RACE] distinct publishers append concurrently
- **WHEN** 多个 SHA 的发布者并发写入或同 SHA 重试
- **THEN** SHALL 保留每份快照、以最新父 ref 重试 fast-forward，已有同 SHA 结果复用且 main 不变

### Requirement: main snapshots use isolated clean source provenance
构建 SHALL 从隔离、固定、干净的 Git 检出索引，核验原始和隔离源码的 HEAD/tree/工作区、原生 root/project/counts 和 git-clean-head 来源标记；manifest SHALL 保存固定源码证明。verifyMain SHALL 拒绝缺失或不一致的来源证明。

#### Scenario: [CBM-DIRTY-BUILD] source changes without a commit during generation
- **WHEN** 原始或隔离源码被修改而 HEAD 不变
- **THEN** SHALL 失败，不产生可发布 manifest；用户修改保留

#### Scenario: [CBM-NATIVE-BASIS] dirty native metadata has matching hashes
- **WHEN** metadata 来源不是 git-clean-head，即使 SHA-256 匹配
- **THEN** verifyMain SHALL 拒绝

### Requirement: shared cache installation validates competing winners
同 SHA 的下载 SHALL 独立暂存且原子落盘；rename 竞争输家 SHALL 严格核验赢家的完整文件、身份、SHA-256 与远端 Git blob 后复用，不信任或删除损坏赢家。

#### Scenario: [CBM-PARALLEL-CACHE] independent checkouts share one valid cache target
- **WHEN** 两个独立 checkout 同时下载同 SHA 且一个落盘成功
- **THEN** 两者 SHALL 复用同一完整缓存，不因 ENOTEMPTY 报失败

#### Scenario: [CBM-CACHE-RETRY] private staging rename is temporarily denied
- **WHEN** 目标尚不存在且落盘遇到短暂权限/共享冲突
- **THEN** SHALL 有界重试；永久拒绝失败，不信任不存在或损坏的赢家

#### Scenario: [CBM-CACHE-RACE] incomplete or foreign winning cache exists
- **WHEN** 竞争赢家缺失文件、校验错误或身份错误
- **THEN** SHALL 拒绝而不返回 ready

### Requirement: MCP readiness gate resolves every project identity
Workspace MCP SHALL 根据原生工具 schema 检查所有项目参数，并覆盖原生接受的额外别名；通过原生解析统一到仓库/数据库身份。compare_graphs 任一目标未准备成功 SHALL 拒绝；无法解析时不得放行。诊断工具可以保留。新对话任务边界与任意 shell/编辑器动作不属于 MCP 强制拦截。

#### Scenario: [CBM-PROJECT-GATE] aliases paths and either compare target refer to a failed repository
- **WHEN** project 使用内部名、别名、绝对路径，或 compare 使用失败的 base/target
- **THEN** SHALL 返回准备失败，不能访问旧图谱；成功准备后恢复

### Requirement: selected workspace repositories cannot disappear on metadata errors
workingRoots/optedRepository SHALL 区分未启用和已选择但 metadata 损坏或身份不符；后者 SHALL 阻止整体 ready。已选择但缺失工作 artifact 的 clone SHALL 仍纳入预期集合，恢复并校验成功后才可 ready；所有预期仓库的成功回执须齐全并匹配实际 Git 身份。

#### Scenario: [CBM-SELECTED-METADATA] selected child metadata is corrupt or foreign
- **WHEN** 已选择子仓 metadata JSON/schema 损坏或项目身份不匹配
- **THEN** 整体 SHALL 失败，不能吞掉异常或仅以父仓成功返回 ready

#### Scenario: [CBM-MISSING-METADATA] selected child is missing its working artifact
- **WHEN** selection 存在但工作 artifact 缺失
- **THEN** 子仓 SHALL 保留在预期集合，恢复成功才能 ready，恢复失败则整体失败

#### Scenario: [CBM-ALL-RECEIPTS] expected child receipt is missing duplicated or forged
- **WHEN** 回执缺仓库、重复根目录或 branch/code/index SHA 不一致
- **THEN** 整体 SHALL 拒绝 ready

### Requirement: discovered root metadata failures gate the session
宿主 roots 上报中发现的已选仓库 metadata 失败 SHALL 按门禁业务失败处理：记录失败身份、保持门禁关闭、不把该 roots 消息转发给原生端，不要求用户先手动 prepare 掩盖失败；项目名、别名、绝对路径与多项目查询均不得绕过门禁。metadata 修复并成功重新准备后，SHALL 可按明确的恢复路径重新开放门禁。

#### Scenario: [CBM-ROOTS-DISCOVERY] corrupted discovered metadata blocks queries without forwarding
- **WHEN** 从通用目录启动的会话通过 roots 上报发现 metadata 损坏、缺失或身份不符的已选仓库
- **THEN** 该根的查询 SHALL 被拒绝且未转发原生端；修复 metadata 并重新上报后同会话重备成功、查询恢复

### Requirement: startup preparation never blocks the client connection
启动准备 SHALL 在后台执行，MCP initialize/tools/list SHALL 立即响应，不因多仓库全量准备的耗时阻塞客户端连接窗口；准备期间针对相应根的查询 SHALL 等待本次准备结果，不穿透门禁。

#### Scenario: [CBM-HANDSHAKE-LATENCY] handshake answers within the connection window
- **WHEN** wrapper 从含多个已选仓库的根启动且全量准备耗时超过客户端连接窗口
- **THEN** initialize SHALL 立即响应，准备在后台完成后门禁按真实结果更新
