# Proposal

## Why

LiteLLM 已发现模型，但 Core 把 models.dev 的能力和 reasoning_options 绑定到实际 serving provider 证明，导致自动配置丢失。用户实际 Pi 注册的 16 个模型均支持推理、保存档位均为空；本变更按用户明确的产品原则纠正规范及设计，先完成设计 Review。

## What Changes

1. 只按 LiteLLM model_name 与明确 models.dev 关系匹配，官方 → OpenCode → OpenRouter 选择一条整记录；内部 route/base_model 不定义模型身份。
2. 直接读取该记录的能力、限制与 reasoning_options；不跨 provider 或 LiteLLM 补字段，不用家族/GPT模板，不要求 models_dev_provider。
3. **BREAKING**：参考价仅来自选中记录，否则0；删除价格阶梯与价格有效性门槛，contextTierCap接受但忽略并在实施时说明。
4. **BREAKING**：删除旧LKG serving/route/multiset证明，保留model_name、scope和关键缓存完整性；旧错误配置通过既有schema机制重建。协议/default/mixed-fallback/override完全保持现状。
5. 保留16模型和公开数据，修订原T01–T34，撤回T05/T06候选裁决；真实宿主E2E仍是实施验收。本轮仅设计。

## Capabilities

### New Capabilities

无。复用现有能力边界，减少规则与状态。

### Modified Capabilities

| Capability | 调整 |
|---|---|
| model-discovery | 消费新 Core 元数据规则 |
| publication | 注册与 LKG |
| provider-diagnostics | 清楚的匹配统计与档位 |
| discovery-quality-integration | 限制与价格映射 |
| discovery-resilience-integration | 消费简化来源 |
| discovery-snapshot | 迁移旧快照 |
| change-sync | 故障恢复一致 |
| model-audit-export | 开发者来源审计 |
| shared-discovery-core | 更新行为基线 |

## Impact

本仓库只消费 Core 结果，维护宿主注册、持久化、诊断和导出；不得复制 Core 匹配算法。
OpenCode >=2.0.15 <2.1，强制验收 2.0.16；涉及 integration/provider transforms、ProviderEditor.add、Model.Info/variants、storage、command/RPC/TUI。experimental SDK 结构可能变化，必须经固定真实宿主验收，不能以类型强转掩盖。

依赖：[litellm-discovery-core 同名 change](https://github.com/rpchen/litellm-discovery-core/tree/codex/restore-model-metadata-priority/openspec/changes/restore-model-metadata-priority)；[pi-litellm-provider 同名 change](https://github.com/rpchen/pi-litellm-provider/tree/codex/restore-model-metadata-priority/openspec/changes/restore-model-metadata-priority)。

设计材料的提交可同时审查。未来获批实施后，Core 先合入稳定 main SHA，再 Pi、OpenCode 各自按该 SHA 构建和验收。本轮不触发构建更新、不改 dist/provenance、版本、canonical specs、历史 archive 或用户配置。

现行规范与用户本次原则的冲突不是实施约束；由本 change 的明确 deltas 替代。详细审计与逐模型预期以 Core change 的 audit.md、design.md、test-matrix.md 和 evidence/ 为准。README 当前行为尚未改变：No README change: no user-visible behavior in this design-only PR；实施必须同步 README、testing-standard §8、相关 ADR 和过时 OpenSpec context。

## 设计约束

用户明确要求、已复现问题、核实数据/接口或基本正确性才可支持行为；Review不能把理论边缘情况自动变成Requirement、Scenario、状态或发布门槛。优先删除错误逻辑和复用已有机制；本次不扩大审计范围。
