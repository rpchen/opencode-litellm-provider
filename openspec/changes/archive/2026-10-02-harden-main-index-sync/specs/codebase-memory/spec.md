## ADDED Requirements

### Requirement: task readiness verifies final remote main
prepare 和 finish SHALL 在等待、下载校验后及返回前重新核验远端 main。目标变化 SHALL 在同一总超时预算内重定向；ready SHALL 记录最终核验时刻、实际分支和一致的 code/index SHA、tree 与三文件校验和。

#### Scenario: [CBM-RETARGET] main advances while prepare or finish waits
- **WHEN** 开始目标 A 的索引等待或下载期间 main 前进为 B
- **THEN** SHALL 获取 B 的准确索引，实际 checkout 与 code/index SHA 同为 B，不声明 A 是最新

#### Scenario: [CBM-TOTAL-BUDGET] repeated target changes cannot restart timeout
- **WHEN** 多次 main 前进或索引发布缺失耗尽最初的总等待预算
- **THEN** SHALL 超时失败而不返回 ready

#### Scenario: [CBM-WORKSPACE-BUDGET] workspace budget expires before the next selected root
- **WHEN** 前一个已选仓库耗尽正数等待预算
- **THEN** 整体 SHALL 失败，不将剩余预算变成无等待上限的零值尝试

#### Scenario: [CBM-NOT-READY] invalid or unavailable service blocks readiness
- **WHEN** 索引缺失、校验失败、网络失败或等待超时
- **THEN** SHALL 保留工作且不写入本次成功 ready 回执

### Requirement: synchronization protects actual symbolic Git state
同步 SHALL 使用 Git common dir 互斥、分支/HEAD/main ref/工作区状态保护及旧 OID CAS；每次 Git 修改前重新核验，返回前读取实际分支和提交，不硬编码成功。不得强制切换、reset、clean 或 stash 用户工作。

#### Scenario: [CBM-CONCURRENT-CHECKOUT] same SHA branch or source changes during download
- **WHEN** 其他进程切到同 SHA 新分支，或产生 tracked/untracked/staged 修改、新提交
- **THEN** SHALL 安全失败并保留分支、main ref、源码字节和暂存内容

#### Scenario: [CBM-COMMON-MUTEX] linked worktrees prepare concurrently
- **WHEN** 一个工作树的客户端正在下载索引而另一个工作树开始准备
- **THEN** 两者 SHALL 使用同一 common Git 锁；后者等待超时失败而不改变分支或源码

#### Scenario: [CBM-PRESERVE-WORK] existing unfinished source remains intact
- **WHEN** 已有未完成分支、本地独有提交、修改或暂存内容
- **THEN** new/finish SHALL 失败且原状态不丢失，只有显式 resume 可继续旧工作

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
