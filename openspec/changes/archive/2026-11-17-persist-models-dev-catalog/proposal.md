## Why
Pi 本机故障证明：重启丢失 models.dev 内存目录，元数据暂不可用时此前可用的全部模型被撤下。OpenCode 存在相同路径。

## What Changes
- 成功的公开 catalog 按来源 URL 保存磁盘；重启先读取，不设 TTL。
- 获取最新目录失败或返回不完整内容时保留已有完整目录。
- 仍按 LiteLLM 当前清单删除模型，不改变 Core 匹配与发布规则。

## Capabilities
### New Capabilities
- `persistent-models-dev-catalog`: 跨进程复用公开目录。

### Modified Capabilities
- `model-discovery`: 完整目录跨重启复用和失败保留。

## Impact
仅修改宿主网络缓存层；Core 无需修改。关联另一 adapter 的同名 change。
