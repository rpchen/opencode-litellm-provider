## Implementation

- [x] 排队 prepare 锁内重读状态、回执仅在失败时失效（四仓共享实现同步）
- [x] roots 发现 metadata 失败按门禁业务失败处理并支持同会话恢复（workspace 客户端）
- [x] 启动准备转后台、MCP 握手不阻塞连接窗口（workspace 客户端）
- [x] 底层超时统一 ETIMEDOUT 错误码、测试断言稳定语义
- [x] 文档、说明与回归入口同步

## Verification

- [x] 修复前旧实现失败、修复后通过的可复核证据（CBM-QUEUED-LOCK 对审核版本实测 Checkout changed before preparation）
- [x] 各仓库共享回归全绿；workspace 全套件全绿
- [x] 精确 head CI 与真实宿主 E2E 以最终推送 head 为准

### Scenario evidence

| Scenario | 自动化入口 |
|---|---|
| CBM-QUEUED-LOCK、CBM-QUEUED-USER-CHANGE | 共享 main.test 两独立进程真实锁排队；锁前旧状态、锁内重读、回执保留、用户修改拒绝 |
| CBM-ROOTS-DISCOVERY | workspace client.test 真实原生 stdio 通用目录启动；metadata 损坏门禁、别名拒绝、修复重备恢复 |
| CBM-HANDSHAKE-LATENCY | workspace client.test 启动准备后台化，握手在连接窗口内完成 |
| CBM-TOTAL-BUDGET | 共享 main.test 断言稳定超时语义，不再依赖偶发英文文案 |