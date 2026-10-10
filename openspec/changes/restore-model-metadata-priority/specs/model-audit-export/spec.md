# Spec Delta

## MODIFIED Requirements

### Requirement: 内容与注册快照一致
导出 SHALL 覆盖同一活动连接的一次成功发现快照中插件实际提交给 `ProviderEditor.add` 的允许的 provider 字段和全部模型，保持模型数量、ID 和排序一致；每模型 SHALL 包含最终 id、modelID、providerID、显示名、所选协议及 package、工具与输入／输出模态、variant id 与 settings、状态、enabled、发布日期、上下文／输入／输出限制、输入／输出／缓存读／缓存写价格及单位。模型名和推理等级 SHALL 保留实际注册值，不得以“敏感”为由省略或静默改写。报告 SHALL 标明它反映的是“插件传给宿主的值”，而非声称包含宿主后续修改后的完整运行时配置；协议是由同一快照关联的插件选择结果，不得伪称为宿主原生字段。报告 SHALL 定义 schema 版本、已知时间与价格单位，并明确发布日期的原值及单位未知时的含义，以及缺失和默认值的含义。

#### Scenario: 最终映射与协议
- **WHEN** 同次发现注册了 Chat 与 Responses 模型，包含推理档位、上下文限制
- **THEN** 报告的模型集合和排序与该次插件提交的注册输出一致，逐模型协议与 package 对应，variants、价格和限制为实际提交值而不是未转换的 LiteLLM 响应

#### Scenario: 无推理档位或未知字段
- **WHEN** 模型未获得可用的推理档位或某字段只取得默认值
- **THEN** 报告使用约定的空数组／默认值和说明，不将未知情况虚构为经上游验证的事实

#### Scenario: 发布日期保留注册原值
- **WHEN** 某模型的发布日期由日期字符串解析而来，另一模型的上游发布日期直接给出数值
- **THEN** 报告对两者均保留提交给宿主的数值；明确前者当前为 Unix 毫秒，后者未经单位归一化、单位未知，不将两者一律标成秒

## ADDED Requirements

### Requirement: Metadata provenance audit
OpenCode SHALL 在现有主动导出中以allowlist增加Core canonical ID、实际选中公开record key/provider、字段来源、选项未知/明确为空与快照来源。MUST NOT 复制raw LiteLLM/models.dev、route、URL、credential或任意扩展字段；报告保留实际注册值和原模型名，不自动导出。

#### Scenario: [T23] 安全可追溯
- **WHEN** 用户主动导出且原始输入藏有测试secret/URL/route
- **THEN** 报告有公开元数据来源与真实注册档位，未从非允许字段复制敏感值
