## ADDED Requirements

### Requirement: 凭据变化同步撤销快照状态
连接身份或凭据变化使已发布快照失效时，插件 SHALL 同步撤下旧模型并清除旧 applied 状态；后续发现失败 SHALL 显示实际错误，不能继续声称使用旧快照。

#### Scenario: [SNAPSHOT-KEY-ROTATION] 同一连接更新 Key 后网络失败
- **GIVEN** 已恢复并发布兼容快照
- **WHEN** 同一 connection ID 下 API Key 改变且新发现失败
- **THEN** 旧模型不发布，applied 为 error 且无旧 modelCount，诊断不声称仍使用旧快照

测试证据：test/sync.test.ts 的 credential rotation invalidates 参数化测试覆盖 legacy 与多 endpoint；既有 startup publishes 测试覆盖凭据未变的离线保留。
