# Spec Delta

## REMOVED Requirements

### Requirement: 共享发现逻辑的唯一维护位置
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 OpenCode single Core implementation；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

## ADDED Requirements

### Requirement: OpenCode single Core implementation
宿主无关LiteLLM发现、身份、能力、价格、推理、发布及LKG SHALL 仅在Core维护，OpenCode经公共入口消费，保留宿主SDK/网络/刷新/凭据/审计。兼容基线遵循获批Core契约，不要求保持旧proof/cap错误；生成源码不得手工维护或提交。

#### Scenario: [T34] 同一Core事实
- **WHEN** 固定SHA返回中立ModelSpec
- **THEN** OpenCode只补宿主映射，核心事实保持一致，无本地resolver副本
