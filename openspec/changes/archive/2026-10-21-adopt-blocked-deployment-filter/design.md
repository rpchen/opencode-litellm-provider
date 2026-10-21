## Context

上游 LiteLLM 1.99.0 中 /v1/models 排除全部 blocked deployment 的模型名，/model/info 保留管理元数据。Core #39 已实现通用 blocked===true 过滤，并在归一化分组入口统一构建、诊断和增量名称集合。本仓库只采用其公共入口。

## Goals / Non-Goals

- 目标：OpenCode 运行中刷新后撤销全部暂停模型，保留可发布对话模型和另一 endpoint 的清单。
- 不增加 /v1/models 请求；不改变协议、模型元数据、网络失败降级或 LKG 策略；不添加具体模型名称特判。

## Decisions

1. 更新构建固定 Core 1ff0979c8f22ec06479331d94ced2cf466f1fd42，固定复验读取候选 provenance；安装隔离仅消费已提交 dist，缓存继续核对 Git 对象与脏工作树。
2. 合成样本复制自该 Core 提交：29 条 deployment/25 个名称，参考可见集合15，其中 embedding 和元数据不足的 chat 不发布，最终13。此为合成行为证据，并非 company 实际导出。
3. 先发布未暂停的20个对话模型，再仅改变 blocked 标志，保留原始 model_name 集合；通过原刷新入口验证注册、持久化与 diagnostics 不复活七个 GPT。真实宿主同时验证另一 endpoint 不受影响。
4. 沿用轮询与显式刷新；网络失败、models.dev 不可达、缓存和 LKG 不变。协议与推理档位沿用既有 Core → OpenCode 映射。

## Behavior Changes

| 差异 | 理由 |
|---|---|
| model_info.blocked===true 的 deployment 不再贡献已发布模型 | 与 LiteLLM 暂停语义一致 |
| 名称未变化但全部 deployment 被暂停的模型在刷新时撤销 | Core 归一化模型集合参与增量差异 |

## Validation

单元回归先证明旧 Core 失败，再验证新 Core；真实 OpenCode 从固定 Git commit 安装，在隔离配置和本地 fake LiteLLM 验证模型注册与命令。现有失败边界、包隔离与固定产物校验继续运行。
