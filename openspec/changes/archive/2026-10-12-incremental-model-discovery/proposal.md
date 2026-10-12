# Proposal

## Why

OpenCode 当前每次有效的发现刷新都会重新加载 models.dev 并对全部 LiteLLM 模型执行 Core 元数据解析。轮询中模型集合通常不变，这会造成不必要的本地解析和 models.dev 访问；内部 route、base_model 或 deployment ID 的变化也不应被当作模型身份变化。

## What Changes

1. 以 Core 过滤后的 `model_name` 集合作为发现增量身份；集合不变时复用上次成功结果，不重新匹配元数据或访问 models.dev。
2. 集合变化时仅撤销删除项、处理新增项；新增项先使用现有本地 catalog，只有本地没有可匹配记录时才请求最新 catalog；未变化项继续复用原 ProviderSnapshot、注册视图、publication 与诊断结果。
3. 移除 models.dev 成功结果的固定 6 小时过期；保留现有请求退避与故障降级，最新 catalog 请求只由新增模型的匹配需要触发。

## Capabilities

### Modified Capabilities

| Capability | 调整 |
|---|---|
| model-discovery | 增加按 `model_name` 集合的增量处理和按需 catalog 访问 |
| discovery-snapshot | 成功注册配置在同一模型集合中直接复用 |
| refresh-coordinator | 保持 LiteLLM 轮询/强制刷新语义，避免重复元数据处理 |

## Impact

只修改 OpenCode 宿主适配层的发现生命周期、内存 catalog 缓存和测试；Core 继续负责 model_name 匹配、整记录选择、publication、withheld 与 LKG。无新增命令、UI、重试状态或运行时依赖。

README 同步说明 catalog 不再按时间刷新，以及新增模型触发最新 catalog 请求。
