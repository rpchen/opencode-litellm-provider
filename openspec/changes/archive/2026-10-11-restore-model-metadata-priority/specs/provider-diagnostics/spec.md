# Spec Delta

## REMOVED Requirements

### Requirement: 诊断与 TUI 展示 canonical 与 serving 事实
**Reason**: 默认内部证明与声明提示误导用户。
**Migration**: 显示元数据来源/支持档位/实际缺口；详细来源放主动审计。

## ADDED Requirements

### Requirement: Model metadata summary
OpenCode SHALL 默认展示发现/已配置/暂不可用、实际元数据来源、推理支持与可选档位、缺失或冲突字段。MUST NOT 提示models_dev_provider或默认列出候选provider/serving证明；matched消费Core实际采用能力统计。保留endpoint状态、缓存年龄及Runtime Identity短值，command/UI与state同源。

#### Scenario: [T22] 匹配成功
- **WHEN** 16项自动采用models.dev能力
- **THEN** 统计反映实际匹配，不因无声明计0

#### Scenario: [T31] 诊断纵向一致
- **WHEN** 从Core到state再到command/RPC/UI
- **THEN** 来源、档位与注册一致，无内部proof噪音
