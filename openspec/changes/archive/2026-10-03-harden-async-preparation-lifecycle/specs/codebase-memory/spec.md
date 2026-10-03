## ADDED Requirements

### Requirement: preparation outcomes are isolated per root and round
每个仓库的门禁结论 SHALL 归属于具体的准备轮次。每次准备尝试 SHALL 占用该仓库递增的轮次编号，成功与失败回调 SHALL 只在自身轮次仍是最新时写入结论；来自较早轮次的回调（例如启动后台准备或已关闭根目录的恢复尝试）SHALL NOT 覆盖或清除较新轮次的失败结论。

#### Scenario: [CBM-PREPARE-ROUNDS] late background success cannot clear a newer explicit failure
- **WHEN** 启动后台准备仍在进行时，宿主发出显式 prepare/finish 并因无效参数或未提交工作失败
- **THEN** 后到达的后台成功 SHALL NOT 放行该根；受影响项目的查询 SHALL 继续被门禁拒绝

### Requirement: host disconnect cancels background preparation and every session
wrapper SHALL 跟踪准备子进程与创建中/已建立的 native 会话。宿主 stdin EOF 和 SIGINT/SIGTERM SHALL 立即进入关闭状态：取消在跑的准备子进程、释放已建立会话，并释放关闭后才创建完成的会话；关闭后 SHALL NOT 再新建 observer 会话或留在后台存活。正常退出 SHALL 同样关闭已建立的 watcher 会话。

#### Scenario: [CBM-LIFECYCLE-EARLY] early EOF does not leak a late watcher session
- **WHEN** 宿主在启动准备完成前关闭 stdio 连接，且准备仍在进行
- **THEN** wrapper SHALL 退出，且不存在为其 fixture 新建的客户端子进程

#### Scenario: [CBM-LIFECYCLE-NORMAL] normal EOF closes established watcher sessions
- **WHEN** 准备已settle、watcher 会话已建立后宿主正常关闭连接
- **THEN** wrapper SHALL 关闭这些会话并退出，不残留 watcher 子进程

### Requirement: the protocol process never performs synchronous identity resolution
协议进程 SHALL NOT 在 initialize/tools/list 路径上同步执行项目身份解析，包括最近 Git 根解析、工作区清单扫描与宿主上报根的别名/路径归一化。这些解析 SHALL 在独立子进程完成后回传结果；解析期间针对相应根的查询 SHALL 等待本次准备结果，不穿透门禁。

#### Scenario: [CBM-STARTUP-ISOLATION] slow identity scan keeps the handshake and the gate responsive
- **WHEN** 启动根的清单或别名解析需要数分钟
- **THEN** initialize 与 tools/list SHALL 在正常窗口内响应，准备期间的查询 SHALL 等待准备结果而不穿透

### Requirement: queued lock regression blocks the implementation's own pre-lock read
排队锁回归 SHALL 由 fixture 在实现自身的锁前身份读取处阻塞第二个客户端，使携带锁前旧快照的实现真实失败；历史负向控制 SHALL 只替换外部 I/O 适配，保留旧状态机所需的辅助函数，并对真正携带该缺陷的提交验证失败。

#### Scenario: [CBM-QUEUED-LOCK] a queued second client accepts the advanced checkout
- **WHEN** 两个独立客户端进程在同一 checkout 上排队获锁，第一个推进 main 到 B 并写入有效 ready 回执，第二个在锁前读取处被卡住后获锁
- **THEN** 第二个 SHALL 在锁内重读并验证实际状态，成功准备 B，且前一任务的有效回执保留；携带锁前快照的旧实现 SHALL 失败
