# Spec Delta

## REMOVED Requirements

### Requirement: Adapter consumes Core publication facts without re-deriving policy
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Consume one Core publication result；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

## ADDED Requirements

### Requirement: Consume one Core publication result
OpenCode SHALL 透传Core publication、catalog、withheld、来源和通知决定，不重新推断完整性、冲突、价格权威或serving provider；同一结果提供给注册和诊断。

#### Scenario: [T31] 只有Core判定
- **WHEN** Core返回部分可发布模型及原因
- **THEN** 宿主只注册该集合，UI与审计解释一致
