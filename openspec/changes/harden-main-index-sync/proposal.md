## Why

审核复现 main/分支竞态、pending 发布替换、脏源码证明、缓存并发、MCP 参数绕过和已选子仓错误被跳过。修复现有四 PR 的工具链安全，不涉及产品需求。

## What Changes

增加七类同步安全不变量与真实 Git/原生 MCP 回归；四仓库同一实现和共享测试。

## Capabilities

### Modified Capabilities
- codebase-memory: 增加同步、来源、排队与门禁安全要求。

## Impact

仅 scripts、CI、README、开发说明与 OpenSpec；Pi/OpenCode 宿主产品 API、dist/provenance、peer/依赖、模型发现与注册不变。无新运行时依赖，不使用新的宿主 ExtensionAPI/PluginContext；现有固定宿主 E2E 继续验证原契约。保持四 PR 未合并，不调整仓库策略。

互链：Workspace #2、Core #25、OpenCode #52、Pi #44；同名 change 分别在三个子仓。
