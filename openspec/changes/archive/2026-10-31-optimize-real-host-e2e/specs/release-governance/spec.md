## ADDED Requirements

### Requirement: isolated real host groups preserve complete coverage
真实OpenCode门禁 SHALL 通过独立隔离的测试组覆盖原有安装、凭据、模型请求、配置管理、自动恢复与持久化场景；每组 SHALL 通过真实宿主建立状态前置，不得以写入持久状态或强制刷新替代自然恢复验证。

#### Scenario: complete parallel real host validation
- **WHEN** 同一固定产品候选在隔离测试组执行完整真实宿主验证
- **THEN** 所有原有必要断言、全部模型请求、旧凭据与activation负向前置以及自然恢复和重启链均有成功证据，且分别记录测试输入与耗时

### Requirement: aggregate host gate rejects incomplete execution
唯一 `Real OpenCode latest E2E` check SHALL 在完整模式要求所有必需宿主准备及测试组成功；仅在下述实际输入复用条件全部满足时允许本轮交付验证加完整基线复用，并保留现有主分支规则与准确main CI后索引发布顺序。

#### Scenario: a required group does not succeed
- **WHEN** 宿主准备或任一必需测试组失败、取消、意外跳过或缺失
- **THEN** 汇总门禁不得成功，且不得触发成功main CI的索引发布

#### Scenario: all required groups succeed
- **WHEN** 宿主准备和所有必需隔离组均成功
- **THEN** 同名且唯一的required check成功，并可追溯各组输入、结果与完整轮耗时

### Requirement: reuse only verified complete real host inputs
门禁 SHALL 比较安装candidate与测试harness各自完整Git对象清单；仅允许README、当前版本release notes以及manifest/lock/runtime identity的明确版本字段差异。精确宿主与实际安装依赖、Node/npm、OS/架构、runner image和相关配置 SHALL 与同仓实际完整成功run/attempt一致。基线 SHALL 经GitHub运行、完整组及测试步骤回读确认，不得递归引用仅交付验证的运行；缺失或不匹配时 SHALL 完整运行。

#### Scenario: matching delivery reuses a full baseline
- **WHEN** 当前候选真实安装、加载、身份与provenance、模型注册及真实请求通过，且全部实际输入比较与完整基线回读均通过
- **THEN** 门禁展示复用run/attempt及比较依据，允许明确跳过本轮完整组，不宣称本轮执行过完整矩阵

#### Scenario: changed or unverifiable inputs run complete groups
- **WHEN** 非允许Git字段、宿主、安装依赖或运行环境变化，或基线缺失、过期、非完整、失败、取消、attempt不匹配或不可回读
- **THEN** 门禁执行完整A/B/C/D组，不以分支名、PR标题或版本号推定等价

#### Scenario: current delivery failure blocks reuse
- **WHEN** 当前候选的真实安装、加载、身份、注册或模型请求失败
- **THEN** 必需门禁失败，不引用此前成功覆盖本轮失败
