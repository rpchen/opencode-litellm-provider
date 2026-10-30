# Proposal

## Why

冷启动首轮网络发现耗时期间宿主返回不含 LiteLLM 的模型列表，客户端可能永久缓存这一结果。

## What Changes

- 初始化时发布已验证兼容的本地成功快照，后台发现继续执行。
- 新增快照待确认状态，网络失败保留快照；认证和无效配置等原有边界不变。
- 将 Bun 插件测试与 Node 脚本测试分别执行，保留全部原有测试，避免 Bun 加载 node:test 的不兼容。
- 声明 OpenCode 2.2 兼容范围，CI 和分支保护改为运行解析后的最新 V2 稳定版。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `endpoint-state-consistency`: 区分快照待确认与已生效，并允许兼容快照发布。
- `discovery-snapshot`: 规定初始化、后台发现和不兼容快照的行为。
- `distribution`: 扩展宿主兼容范围并在 CI 检查最新 V2 稳定版。
- `release-governance`: 分支保护切换至最新宿主检查。
- `multi-endpoint-activation`: 使用最新宿主验证真实注册与交互。
- `runtime-identity`: 使用最新宿主验证运行身份。

## Impact

影响 OpenCode v2 的 integration.connection、provider.transform/reload、storage、event、command 和 RPC，沿用现有接口与依赖；宿主插件 API 属于实验性接口，必须用固定版本真实宿主 E2E 验证初始化和模型列表。无 core 算法或 generated 源码变更。
