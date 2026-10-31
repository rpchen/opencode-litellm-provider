## ADDED Requirements

### Requirement: 初始化发布兼容快照

插件 SHALL 在初始化完成之前发布启用、配置合法、持有凭据且与当前 endpoint 兼容的上次成功快照；不等待网络发现。legacy 与多 endpoint SHALL 一致。后台发现成功后更新结果，暂时网络失败时保留快照；认证和 notfound 的现有失效规则不变。

#### Scenario: [STARTUP-SNAPSHOT] 初始化读取
- **GIVEN** 启用的 endpoint 有兼容快照和有效配置、凭据
- **WHEN** 插件初始化完成而网络请求仍未结束
- **THEN** 宿主首次模型读取包含快照模型，状态为来自上次快照、待确认

#### Scenario: [STARTUP-OFFLINE] 网络不可用
- **WHEN** 初始化发布快照后网络发现失败
- **THEN** 快照模型仍可读取，状态仍说明来源和待确认

#### Scenario: [STARTUP-NO-SNAPSHOT] 无兼容快照
- **WHEN** 不存在兼容快照
- **THEN** 不发布旧模型，初始化不等待网络发现

#### Scenario: [STARTUP-GATE] 不允许恢复
- **WHEN** endpoint 停用、配置非法、无凭据或快照不兼容
- **THEN** 不发布该快照
