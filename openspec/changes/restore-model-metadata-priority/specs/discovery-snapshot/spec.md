# Spec Delta

## REMOVED Requirements

### Requirement: durable compatible restore
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 OpenCode current-policy snapshot restore；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

## ADDED Requirements

### Requirement: OpenCode current-policy snapshot restore
OpenCode SHALL 仅在Core接受schema2及关键完整性、endpoint/credential/结果相关scope一致时恢复中立模型；contextTierCap与price不决定scope或可用性。保持plugin durable storage、stale标记及既有endpoint-state门禁。 旧schema不恢复；价格错误由Core归零，关键损坏仍拒绝。

#### Scenario: [T19] 旧策略不回放
- **WHEN** 只有schema1快照
- **THEN** 等待成功刷新重建，不暴露旧空档位/cap

#### Scenario: [T21] scope不兼容
- **WHEN** credential、endpoint或协议选项改变
- **THEN** 不恢复旧模型

#### Scenario: [T19] 价格损坏
- **WHEN** 关键配置与指纹合法但cost损坏
- **THEN** 恢复能力并显示参考价0
