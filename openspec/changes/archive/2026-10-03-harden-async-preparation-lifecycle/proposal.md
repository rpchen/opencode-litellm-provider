## Why

审核复审确认上一轮修复后仍有三处 P2 异步生命周期缺陷，并指出现有排队回归的时序无法真正卡住旧实现：

1. 较早启动的后台准备成功会清除较新的显式准备失败门禁，查询在应当拒绝时被放行。
2. 宿主连接关闭后后台续作仍会新建 observer 会话，wrapper 进程不退出。
3. 协议进程在第一个 await 之前仍可能同步执行项目身份解析，慢解析会阻塞 MCP initialize。

此外 [CBM-QUEUED-LOCK]/[CBM-QUEUED-USER-CHANGE] 的 barrier 放在调用实现之前，旧实现在同一位置同样通过，不能作为锁前快照缺陷的负向控制；历史回放脚本切分 `api()` 时删掉了旧状态机仍调用的辅助函数，把真实旧故障掩盖成 ReferenceError。

本 change 只修复现有四条 PR 的工具链异步生命周期并校正回归时序，不涉及产品需求、宿主适配层或 dist/provenance。

## What Changes

- 门禁准备结果按仓库与准备轮次隔离：每次准备尝试占用递增轮次并携带该轮次回报，较早轮次的回调不得覆盖较新轮次的成功/失败结论。
- 关闭状态与后台取消：统一跟踪准备子进程与创建中/已建立的 native 会话；宿主 EOF 与 SIGINT/SIGTERM 立即进入关闭状态，取消在跑准备、释放所有会话，关闭后才完成的创建也会立即释放。
- 握手完全解耦：协议进程不再执行同步项目身份解析；启动根解析异步化，工作区清单扫描与宿主上报根别名/路径归一化移入独立子进程，扫描期间查询由门禁 pending 挡住。
- 回归时序校正：排队用例的 barrier 由 fixture 注入实现自身锁前的 `services.repository` 读取；历史回放只替换 `api()` 签名与函数体，并新增携带锁前快照的提交作为第二个负向控制。

## Capabilities

### Modified Capabilities
- codebase-memory: 增加准备轮次隔离、关闭取消、握手零同步解析与排队回归时序要求。

## Impact

仅 scripts、测试、README/开发说明与 OpenSpec；Pi/OpenCode 宿主产品 API、dist/provenance、peer/依赖、模型发现与注册不变。无新运行时依赖，不使用新的宿主 ExtensionAPI/PluginContext；现有固定宿主 E2E 继续验证原契约。四仓库共享实现与共享回归保持逐字节同构；workspace 专属客户端修复不复制到不适用的子仓。保持四 PR 未合并，不调整仓库策略。

互链：Workspace #2、Core #25、OpenCode #52、Pi #44。
