## ADDED Requirements

### Requirement: isolated real host groups preserve complete coverage
真实OpenCode门禁 SHALL 通过独立隔离的测试组覆盖原有安装、凭据、模型请求、配置管理、自动恢复与持久化场景；每组 SHALL 通过真实宿主建立状态前置，不得以写入持久状态或强制刷新替代自然恢复验证。

#### Scenario: complete parallel real host validation
- **WHEN** 同一固定产品候选在隔离测试组执行完整真实宿主验证
- **THEN** 所有原有必要断言、全部模型请求、旧凭据与activation负向前置以及自然恢复和重启链均有成功证据，且分别记录测试输入与耗时

### Requirement: aggregate host gate rejects incomplete execution
唯一 `Real OpenCode latest E2E` check SHALL 仅在所有必需宿主准备及测试组成功时成功，并保留现有主分支规则与准确main CI后索引发布顺序。

#### Scenario: a required group does not succeed
- **WHEN** 宿主准备或任一必需测试组失败、取消、意外跳过或缺失
- **THEN** 汇总门禁不得成功，且不得触发成功main CI的索引发布

#### Scenario: all required groups succeed
- **WHEN** 宿主准备和所有必需隔离组均成功
- **THEN** 同名且唯一的required check成功，并可追溯各组输入、结果与完整轮耗时
