# Design

## Context

OpenCode 的 discovery loop 仍然负责连接生命周期、ProviderSnapshot、reload、持久 snapshot 和注册。Core 已经定义 `model_name` 分组、models.dev 选择、publication gate、withheld 与 LKG；本变更不复制这些规则。

## Decisions

### 身份与增量

每个 endpoint 的最近一次成功 coordinated value 保留 Core publication partition、诊断和 `model_name` 集合。每次实际 LiteLLM 刷新先通过 Core 的 `groupLiteLLMDeployments` 得到集合：集合相同直接返回最近结果；集合变化只把新增部署交给 Core，删除项从上次 partition 移除，未变化项逐项复用。比较不读取 `litellm_params`、`base_model` 或 deployment ID。

### models.dev 请求

成功的内存 catalog 不按时间失效。新增模型先读取本地 catalog；若 Core 结果显示新增模型没有选中记录，才绕过本地快照请求最新 catalog 并只重新处理新增项。首次有模型的发现同样需要 catalog；删除、同名 route 变化和没有新增项的刷新不访问 models.dev。既有 60 秒失败退避、空对象降级、ProviderSnapshot/LKG 处理保持不变。

### 非目标

不添加持久化状态机、命令、UI、重试机制或新的匹配/fallback。持久 snapshot 的 endpoint scope、关键指纹、endpoint-state 门禁和 Provider reload 规则不变；成功清单删除仍然撤销注册，认证/网络故障仍沿既有 host/Core 路径处理。

## Evidence

实现依据是当前 discovery loop、Core 的 `model_name` 分组与现有 in-memory catalog cache；没有为未观察到的边缘情况增加额外状态。增量测试覆盖集合不变、新增本地命中、新增本地未命中、删除和内部 route 变化。
