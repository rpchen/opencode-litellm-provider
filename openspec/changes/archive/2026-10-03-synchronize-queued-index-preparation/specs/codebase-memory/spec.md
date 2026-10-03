## MODIFIED Requirements

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

## ADDED Requirements

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