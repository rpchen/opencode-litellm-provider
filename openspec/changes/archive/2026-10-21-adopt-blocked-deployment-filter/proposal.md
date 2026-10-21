## Why

LiteLLM 1.99.0 的 Models Disable 开关通过 model_info.blocked=true 暂停 deployment；/model/info 仍保留它们。旧 Core 会继续发布已全部暂停的 GPT 模型。Core #39 已合并，本插件需要实际采用修复并验证运行中撤销模型。

## What Changes

- 使用已合并 Core 完整 SHA 1ff0979c8f22ec06479331d94ced2cf466f1fd42 更新 dist/provenance，不复制过滤算法。
- 加入固定合成样本的增量刷新回归与真实 OpenCode 模型注册验收；暂停 company 不影响其他 endpoint。
- 同步 README 的暂停模型行为。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- model-discovery: 发布清单排除已全部暂停的 deployment 组，刷新移除旧模型。

## Impact

依赖 Core #39；两个插件分别提交 PR，固定同一 SHA。仅测试、文档和构建产物变化，不新增运行时依赖、HTTP 请求或缓存 schema。沿用 OpenCode >=2.0.15 <2.1 的 integration/provider、provider.reload、RPC/TUI；experimental 接口依赖面不变。
