## Implementation

- [x] 门禁按仓库与准备轮次隔离结果，旧回调不覆盖较新失败（四仓共享实现同步）
- [x] 关闭状态、后台取消、创建中与已建立会话跟踪及立即释放（workspace 客户端）
- [x] 项目身份解析移出协议进程：异步根解析、子进程清单扫描与别名归一化（workspace 客户端）
- [x] 排队回归 barrier 注入实现自身锁前读取；历史回放只替换 api() 并新增锁前快照负向控制（四仓共享测试同步）
- [x] 文档、决策记录与回归入口同步

## Verification

- [x] 修复前旧实现失败、修复后通过：CBM-PREPARE-ROUNDS、CBM-STARTUP-ISOLATION、CBM-LIFECYCLE-EARLY 对上一版客户端均失败（LIFECYCLE-EARLY 实测 35s 未退出）
- [x] CBM-QUEUED-LOCK / CBM-QUEUED-USER-CHANGE 对 7e9b0e1 实测 2/2 失败，对当前实现 2/2 通过
- [x] 历史回放 node scripts/codebase-memory-review-baseline.mjs 387c1b2 7e9b0e1：审核前提交 11 条用例失败，锁前快照提交排队两例失败
- [x] 各仓库共享回归全绿：workspace npm test 61/61、npm run test:mcp 1/1；三个子仓 test:codebase-memory 各 42/42
- [x] 精确 head CI 与真实宿主 E2E 以最终推送 head 为准

### Scenario evidence

| Scenario | 自动化入口 |
|---|---|
| CBM-PREPARE-ROUNDS | workspace client.test 真实原生 stdio + 悬挂 gh 传输：显式失败后旧后台成功不放行 |
| CBM-LIFECYCLE-EARLY | workspace client.test 提前 EOF + 真实进程枚举：无残留/后启客户端子进程 |
| CBM-LIFECYCLE-NORMAL | workspace client.test 正常 EOF + 真实进程枚举：已建立 watcher 会话消失 |
| CBM-STARTUP-ISOLATION | workspace client.test 600 子仓慢清单：initialize/tools/list 及时、查询等待门禁 |
| CBM-QUEUED-LOCK | 共享 main.test 两独立进程真实锁；barrier 卡在实现锁前读取，7e9b0e1 实测失败 |
| CBM-QUEUED-USER-CHANGE | 同上，锁内真实用户修改仍安全拒绝 |
