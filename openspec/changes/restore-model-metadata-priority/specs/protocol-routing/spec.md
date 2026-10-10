# Spec Delta

## REMOVED Requirements

### Requirement: 多部署协议不一致时回退
**Reason**: Chat回退不能解决实际不兼容协议。
**Migration**: 消费Core冲突withheld或用户既有显式protocolOverride。

## ADDED Requirements

### Requirement: Conflicting deployment protocols
OpenCode SHALL 消费Core多deployment协议冲突；无override时不注册该模型。显式override保留优先权，正常无声明默认不受影响；元数据provider不选择调用协议。

#### Scenario: [T11] 协议冲突
- **WHEN** 同模型明确Chat/Messages冲突且无override
- **THEN** withheld；设置有效显式override后按Core选择映射
