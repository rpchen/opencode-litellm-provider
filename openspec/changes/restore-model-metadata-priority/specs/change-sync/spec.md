# Spec Delta

## REMOVED Requirements

### Requirement: models.dev 不可达时的降级
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 元数据不可用时消费 Core 恢复结果；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

## ADDED Requirements

### Requirement: 元数据不可用时消费 Core 恢复结果
OpenCode SHALL 在catalog失败时消费Core的合法LKG、完整LL或withheld结果，保留既有catalog缓存/重试及刷新触发；MUST NOT 因本轮未取得catalog而无条件删除LKG档位或注册不完整默认模型。成功空LiteLLM目录和auth失败仍按既有规则撤下。

#### Scenario: [T25] catalog超时
- **WHEN** 上轮成功，本轮metadata失败
- **THEN** 有效LKG保持能力/档位；无可用事实项明确withheld
