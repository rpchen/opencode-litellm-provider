# Spec Delta

## REMOVED Requirements

### Requirement: 按价格阶梯截断上下文
**Reason**: 价格不能决定模型能力。
**Migration**: contextTierCap暂时接受但忽略；不再进入新快照有效性scope，实施同步README。

### Requirement: 多部署模型的能力合并
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 消费 Core deployment 一致性；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: 能力字段映射与数据源优先级
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 消费 Core 有序能力字段；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: models.dev 记录选择
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 消费 Core 自动元数据关联；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: 推理档位来源
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 精确宿主推理选项映射；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

### Requirement: 显示名与价格
**Reason**: 旧整组场景包含已废弃策略或与新规则不同的完整性边界，明确替换而非在 MODIFIED 中静默丢弃场景。
**Migration**: 使用本 delta 的 原始模型名与可选参考价；必要行为与负向边界见新场景和共享测试矩阵，历史 archive 保持原样。

## ADDED Requirements

### Requirement: 消费 Core deployment 一致性
OpenCode SHALL 完全消费Core对同model_name组的身份、协议与能力结论；不得自行取LL交集、最小context或最高价。身份或明确协议冲突withhold，其他模型照常发布。

#### Scenario: [T08] 相同身份不同描述
- **WHEN** 两deployment同模型但LL描述不同，Core采用官方能力
- **THEN** 宿主使用Core结果，不重复收窄

#### Scenario: [T11] 冲突部署
- **WHEN** Core报告身份/协议冲突
- **THEN** 宿主不注册该项

### Requirement: 消费 Core 有序能力字段
OpenCode SHALL 消费Core官方 → OpenCode → OpenRouter字段优先级与仅缺失时的同维度LL补缺；不能重写来源、把unknown默认成true/false或将max_input当context。OpenCode保留Core tools、完整input/output与独立context/input/output，SDK默认值不得扩大能力。

#### Scenario: [T10] 明确不支持
- **WHEN** Core将官方tools=false或text-only解析为完整能力
- **THEN** 宿主保持不支持，不用下层或宿主默认补true/image

#### Scenario: [T30] 宿主模态边界
- **WHEN** Core模型无文本会话所需模态
- **THEN** 不伪造text后注册

### Requirement: 消费 Core 自动元数据关联
OpenCode SHALL 只消费Core按精确模型名/canonical关系、官方owner别名及官方 → OpenCode → OpenRouter决定的来源，MUST NOT 维护family表、唯一第三方回退、models_dev_provider override或serving proof。请求model_name保持不变。

#### Scenario: [T02] 官方API不同名
- **WHEN** Core把deepseek-flash关联V4.1Flash
- **THEN** 使用其能力但仍以LiteLLM原model_name请求

#### Scenario: [T03] 官方缺失
- **WHEN** Core使用同身份OpenCode或OpenRouter
- **THEN** 无额外用户配置即注册完整结果

### Requirement: 精确宿主推理选项映射
OpenCode SHALL 独立保持Core reasoningSupported和variants；档位只能来自Core选中reasoning记录自身reasoning_options，不能按GPT/家族或LL effort标志生成。variants和settings原样映射到Model.Info，空variants合法，MUST NOT由Model.Info.default或SDK填出额外档位；不支持reasoning不带推理参数。Messages budget/effort必须保持Core的合法设置。

#### Scenario: [T13] GPT差异
- **WHEN** luna有none而astra没有none
- **THEN** 各自映射真实列表，不套统一模板

#### Scenario: [T14] 支持无档位
- **WHEN** Core支持reasoning但[]、toggle或缺options
- **THEN** 宿主可用且没有额外effort档位

#### Scenario: [T33] OpenCode实际请求
- **WHEN** 用户在真实宿主选择声明档位并调用
- **THEN** 本地服务端收到正确model、协议与精确effort；无档位模型无默认effort

### Requirement: 原始模型名与可选参考价
OpenCode SHALL 保留LiteLLM model_name原样作为id、请求名和显示名；价格仅消费Core官方 → OpenCode → OpenRouter的参考值或0，单位每百万token。MUST NOT 本地优先LL价格或把0称为已证实免费。价格缺失/错误不影响注册、关键能力或LKG。

#### Scenario: [T16] 价格缺失或错误
- **WHEN** Core关键配置完整且价格归零
- **THEN** 宿主正常注册，相同限制与档位

#### Scenario: [T17] 原272k价格tier
- **WHEN** Core返回1050000context
- **THEN** 宿主不得按价格截断
