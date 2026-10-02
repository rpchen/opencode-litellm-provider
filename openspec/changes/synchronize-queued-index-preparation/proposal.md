## Why

审核复现两类已确认缺陷并要求稳定超时断言：排队 prepare 在锁前读取旧 checkout 状态、获锁后误删前一任务刚生成的有效 ready 回执并误报 Checkout changed；从通用目录启动的 MCP wrapper 在 roots/list 发现已选仓库 metadata 失败时，把业务错误当协议解析错误吞掉并放行后续查询。本 change 只修复现有四条 PR 的工具链安全，不涉及产品需求。

## What Changes

锁前只读取定位锁所需路径，获锁后重新读取并验证实际分支、HEAD、tree 与工作区状态；ready 回执只在准备失败时失效。roots 上报的 metadata 失败按门禁业务失败处理，记录失败身份、保持门禁关闭、不转发原生端，metadata 修复后同会话重备并重新开放。启动准备转后台，MCP 握手立即响应，准备期间的查询等待本次结果。底层子进程超时统一携带稳定 ETIMEDOUT 错误码。

## Capabilities

### Modified Capabilities
- codebase-memory: 增加排队锁语义、roots 发现门禁、握手窗口与超时错误稳定性要求。

## Impact

仅 scripts、测试、README/开发说明与 OpenSpec；Pi/OpenCode 宿主产品 API、dist/provenance、peer/依赖、模型发现与注册不变。无新运行时依赖，不使用新的宿主 ExtensionAPI/PluginContext；现有固定宿主 E2E 继续验证原契约。四仓库同一实现与共享测试保持同构；workspace 专属客户端修复不复制到不适用的子仓。保持四 PR 未合并，不调整仓库策略。

互链：Workspace #2、Core #25、OpenCode #52、Pi #44。