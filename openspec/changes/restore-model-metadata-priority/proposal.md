# Proposal

## Why

LiteLLM 已发现模型，但 Core 把 models.dev 的能力和 reasoning_options 绑定到实际 serving provider 证明，导致自动配置丢失。用户实际 Pi 注册的 16 个模型均支持推理、保存档位均为空；本变更按用户明确的产品原则纠正规范及设计，先完成设计 Review。

## What Changes

1. 按可信模型身份自动匹配，元数据固定为官方 → OpenCode → OpenRouter；不要求 models_dev_provider 或实际转发服务商证明。
2. 分开推理支持与可选档位，保存缺失、显式 false、显式空选项的区别；严格保留型号、版本与 SKU。
3. **BREAKING**：删除价格阶梯限制上下文、LiteLLM 价格优先和价格参与发布/LKG 的规则；旧 contextTierCap 配置暂时接受但不再生效。
4. **BREAKING**：替换 schema 8 证明结构与旧诊断字段，旧策略快照需重新发现后才能恢复；保留关键能力、身份、协议及端点隔离校验。
5. 建立真实 16 模型基线、通用负向矩阵和两宿主 E2E 方案；本 PR 仅提交设计，未实现、未发布、未归档。

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
| protocol-routing | 拒绝真实协议冲突 |
| model-audit-export | 开发者来源审计 |
| shared-discovery-core | 更新行为基线 |

## Impact

本仓库只消费 Core 结果，维护宿主注册、持久化、诊断和导出；不得复制 Core 匹配算法。
OpenCode >=2.0.15 <2.1，强制验收 2.0.16；涉及 integration/provider transforms、ProviderEditor.add、Model.Info/variants、storage、command/RPC/TUI。experimental SDK 结构可能变化，必须经固定真实宿主验收，不能以类型强转掩盖。

依赖：[litellm-discovery-core 同名 change](https://github.com/rpchen/litellm-discovery-core/tree/codex/restore-model-metadata-priority/openspec/changes/restore-model-metadata-priority)；[pi-litellm-provider 同名 change](https://github.com/rpchen/pi-litellm-provider/tree/codex/restore-model-metadata-priority/openspec/changes/restore-model-metadata-priority)。

设计材料的提交可同时审查。未来获批实施后，Core 先合入稳定 main SHA，再 Pi、OpenCode 各自按该 SHA 构建和验收。本轮不触发构建更新、不改 dist/provenance、版本、canonical specs、历史 archive 或用户配置。

现行规范与用户本次原则的冲突不是实施约束；由本 change 的明确 deltas 替代。详细审计与逐模型预期以 Core change 的 audit.md、design.md、test-matrix.md 和 evidence/ 为准。README 当前行为尚未改变：No README change: no user-visible behavior in this design-only PR；实施必须同步 README、testing-standard §8、相关 ADR 和过时 OpenSpec context。
