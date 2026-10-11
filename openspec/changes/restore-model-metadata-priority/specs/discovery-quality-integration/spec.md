# Spec Delta

## REMOVED Requirements

### Requirement: OpenCode receives operational limits from capability fallback
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 OpenCode preserves selected limits and reference prices；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

## ADDED Requirements

### Requirement: OpenCode preserves selected limits and reference prices
OpenCode SHALL 保留Core选中整条记录的limits、model_name身份与该记录参考价或0；不再保留LL价格优先。

#### Scenario: [T28] 后备元数据
- **WHEN** 官方缺失，Core选择OpenCode或OpenRouter
- **THEN** 限制和价格按Core结果映射，ID不变
