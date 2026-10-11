# Spec Delta

## REMOVED Requirements

### Requirement: 按价格阶梯截断上下文
**Reason**: 改为Core按model_name整记录选择，不保留部署交集、字段拼接或价格截断。
**Migration**: 使用以下宿主映射；协议选择保留现行protocol-routing，contextTierCap接受但忽略并更新用户文档。

### Requirement: 多部署模型的能力合并
**Reason**: 改为Core按model_name整记录选择，不保留部署交集、字段拼接或价格截断。
**Migration**: 使用以下宿主映射；协议选择保留现行protocol-routing，contextTierCap接受但忽略并更新用户文档。

### Requirement: 能力字段映射与数据源优先级
**Reason**: 改为Core按model_name整记录选择，不保留部署交集、字段拼接或价格截断。
**Migration**: 使用以下宿主映射；协议选择保留现行protocol-routing，contextTierCap接受但忽略并更新用户文档。

### Requirement: models.dev 记录选择
**Reason**: 改为Core按model_name整记录选择，不保留部署交集、字段拼接或价格截断。
**Migration**: 使用以下宿主映射；协议选择保留现行protocol-routing，contextTierCap接受但忽略并更新用户文档。

### Requirement: 推理档位来源
**Reason**: 改为Core按model_name整记录选择，不保留部署交集、字段拼接或价格截断。
**Migration**: 使用以下宿主映射；协议选择保留现行protocol-routing，contextTierCap接受但忽略并更新用户文档。

### Requirement: 显示名与价格
**Reason**: 改为Core按model_name整记录选择，不保留部署交集、字段拼接或价格截断。
**Migration**: 使用以下宿主映射；协议选择保留现行protocol-routing，contextTierCap接受但忽略并更新用户文档。

## ADDED Requirements

### Requirement: 消费 Core 整记录配置
OpenCode SHALL 仅消费Core以model_name按官方 → OpenCode → OpenRouter整记录生成的配置；MUST NOT 复制模型匹配、拼字段、取LL交集/最高价或要求内部身份及serving proof。base_model/route/deployment ID不同不新增发布阻断；原有协议/default/mixed-fallback/override不变。OpenCode保留Core tools、input/output与context/input/output；SDK默认值不得扩大能力。

#### Scenario: [T01] 完整16项
- **WHEN** Core返回冻结16模型配置
- **THEN** 逐字段消费其记录与能力，保留model_name请求ID。

#### Scenario: [T08] 内部信息变化
- **WHEN** 同model_name内部route/base_model变化
- **THEN** 不额外核验或撤下；调用协议仍消费Core现有选择。

#### Scenario: [T10] 明确能力值
- **WHEN** 选中记录给出false、text-only、[]或toggle
- **THEN** 不从低优先来源或宿主默认添加能力；遵守实际宿主表达边界。

#### Scenario: [T03] 官方记录不存在
- **WHEN** Core选中OpenCode或OpenRouter整记录
- **THEN** 直接消费，不要求用户补provider声明。

### Requirement: 精确宿主推理选项映射
OpenCode SHALL 独立保留Core reasoning支持与variants，只映射选中记录的reasoning_options，不从GPT模板、家族或LL标志生成。variants/settings映射到Model.Info；支持无effort保持空variants，不让默认值新增档位。本轮不扩展Messages预算推导，保留已有兼容映射。

#### Scenario: [T13] GPT各自档位
- **WHEN** luna有none而astra/6.1-sol无none
- **THEN** 分别映射各自列表。

#### Scenario: [T14] 支持无档位
- **WHEN** Core reasoning=true且options=[]或toggle
- **THEN** 保持支持而无额外effort档位。

#### Scenario: [T33] 真实宿主请求
- **WHEN** 真实宿主注册、选择档位并调用
- **THEN** picker与请求参数符合记录；无effort模型不泄漏默认effort，不支持推理用例无推理参数。

### Requirement: 原始模型名与可选参考价
OpenCode SHALL 保留model_name原样作为ID、请求名和显示名；只消费Core所选记录参考价或0。MUST NOT 跨provider补价、优先LL价格、把0宣称免费或按价格截断限制。价格不影响注册、能力与LKG。

#### Scenario: [T16] 价格缺失或错误
- **WHEN** 所选记录价格归零而其他provider有价格
- **THEN** 使用0且仍正常注册，限制/档位不变。

#### Scenario: [T17] 原272k价格阶梯
- **WHEN** Core context为1050000
- **THEN** 宿主不再截断；旧contextTierCap忽略。
