## ADDED Requirements

### Requirement: 持续验证最新 OpenCode V2

CI SHALL 在每次运行时从 npm latest 解析完整稳定 OpenCode 版本，以该版本的真实宿主和固定候选提交执行 E2E，即使其超出已声明兼容范围也必须执行兼容验证。

#### Scenario: [HOST-LATEST] 验证最新稳定版
- **WHEN** CI 执行真实宿主矩阵
- **THEN** 它记录本次解析的完整稳定版本，并用该版本安装和测试候选插件

#### Scenario: [HOST-OUTSIDE-RANGE] 最新版超出兼容声明
- **WHEN** latest 不在插件声明的宿主兼容范围内
- **THEN** CI 仍测试该最新版本，不因旧声明跳过测试
