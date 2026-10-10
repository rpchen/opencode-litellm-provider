# Spec Delta

## REMOVED Requirements

### Requirement: LKG 以 schema 8 同 resolution 派生
**Reason**: schema8 proof构成不符合新价格与身份规则。
**Migration**: 使用Core当前策略捕获，旧8不当9恢复。

### Requirement: Publication partition governs registration
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Core publication controls host registration；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: Conservative host tool mapping
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Explicit OpenCode tool capability；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: Failures and LKG are visible and safe
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 Host handling of metadata outages；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

## ADDED Requirements

### Requirement: Current Core configuration cache
OpenCode SHALL 从同一Core resolution best-effort捕获schema9内存LKG，不复制兼容算法；持久化中立snapshot为schema2。旧schema经成功发现重建，seeding/存储失败不得使成功发现失败。

#### Scenario: [T19] 策略迁移
- **WHEN** 存在8/1旧条目且目录中断
- **THEN** 不回放旧策略；成功刷新后捕获9/2

### Requirement: Core publication controls host registration
OpenCode SHALL 仅注册Core configured/configured-lkg，完整保留原ID、limits、capabilities、variants与参考cost。其他模型保留具体诊断；禁止确认/acceptance把withheld转成published。有限正context/output守卫继续存在。低优先LL描述差异不否定Core固定来源选择。

#### Scenario: [T01] 完整16模型
- **WHEN** Core处理固定16项返回配置
- **THEN** 逐字段等于Core oracle，DeepSeekFlash输出393216

#### Scenario: [T03] 合法后备记录
- **WHEN** Core采用OpenCode/OpenRouter且LL描述不同
- **THEN** 照常消费，不要求证明实际provider

#### Scenario: [T30] 非法关键上限
- **WHEN** 不正或非有限context/output误入mapper
- **THEN** 不注册

### Requirement: Explicit OpenCode tool capability
OpenCode SHALL 保持Core明确tools布尔值；unknown不正常注册，不再用disabled把未知模型伪装为完整，也不得采用SDK默认true。

#### Scenario: [T30] tools未知
- **WHEN** Core工具能力未知且无有效LKG
- **THEN** 模型withheld

#### Scenario: [T10] tools明确false
- **WHEN** 其他关键能力完整
- **THEN** 正常注册且tools=false

### Requirement: Host handling of metadata outages
OpenCode SHALL 消费Core完整LL/合法LKG/withheld结果，保留source和age、retry与具体缺口；低优先描述及价格变化不是失效条件。只持久化publishable中立结果，auth/删除/身份协议改变不得复活旧模型。

#### Scenario: [T18] catalog失败
- **WHEN** Core允许同身份关键配置LKG
- **THEN** 继续注册并显示上次成功来源

#### Scenario: [T16] 价格故障
- **WHEN** 仅价格缺失或错误
- **THEN** 不撤下，不触发能力regression

#### Scenario: [T20] 模型已删除
- **WHEN** 成功live目录无该模型
- **THEN** 不从快照恢复
