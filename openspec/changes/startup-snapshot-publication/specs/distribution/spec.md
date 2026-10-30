## ADDED Requirements

### Requirement: 持续验证最新 OpenCode V2

CI SHALL 在每次运行时从 npm latest 解析完整 OpenCode V2 版本，以该版本的真实宿主和固定候选提交执行 E2E。解析到的版本不属于已声明兼容范围时 SHALL 失败，提示更新范围和验证。

#### Scenario: [HOST-LATEST] 验证最新稳定版
- **WHEN** CI 执行真实宿主矩阵
- **THEN** 它记录本次解析的完整 V2 版本，并用该版本安装和测试候选插件

#### Scenario: [HOST-OUTSIDE-RANGE] 最新版超出兼容声明
- **WHEN** latest 不在插件声明的宿主兼容范围内
- **THEN** CI 明确失败，不伪称兼容
