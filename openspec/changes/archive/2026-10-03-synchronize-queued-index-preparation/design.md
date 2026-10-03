## Context

本 change 处理本轮两类已确认审核缺陷与超时断言稳定性。

## Decisions

排队语义、回执失效时机、roots 发现门禁与恢复路径、握手窗口和超时错误语义均见各仓库 docs/codebase-memory.md 的同步安全边界与 workspace 总仓库同一文档。锁前只读稳定定位信息；锁内重读真实状态；真实用户并发修改仍按分支/修改/CAS 检查拒绝。门禁失败不退化成未发现或未启用；恢复必须走明确重备路径。

## Verification

共享 codebase-memory-main.test.mjs 用两个独立子进程在同一真实 checkout 上排队获锁（真实 bare remote、真实锁与 CAS），断言锁前旧状态读取、锁内新状态接受、前一任务回执保留与用户并发修改拒绝。workspace codebase-memory-client.test.mjs 以真实原生 stdio 从通用目录启动，覆盖 roots 发现的 metadata 损坏/身份不符门禁、同会话修复恢复与握手不阻塞连接窗口。旧实现（审核版本）在同批回归上失败，修复后通过。产品 LiteLLM fixtures、宿主 provider/UI/Core 语义未触及，原 CI 与真实宿主 E2E 继续运行。