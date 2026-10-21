## ADDED Requirements

### Requirement: 暂停 deployment 的宿主发布与刷新
插件 MUST 采用 Core 的暂停过滤结果；全部 deployment 的 model_info.blocked 严格为 true 的模型 SHALL 不进入宿主对话模型清单。模型原始名称未变化时，成功刷新 SHALL 撤销此前发布的全部暂停模型，不通过旧发布状态恢复它们。

#### Scenario: [BLOCKED-HOST-REFRESH] 名称不变的暂停刷新撤销模型
- **WHEN** company 已发布合成样本的20个对话模型，服务端保留29条 deployment 和25个名称，仅暂停七个 GPT 的全部 deployment，然后成功刷新
- **THEN** company 仅发布13个具备完整元数据的可用对话模型，持久化和诊断与发布一致，集合包含于参考可见15个名称，embedding 与元数据不足模型不进入宿主列表

#### Scenario: [BLOCKED-HOST-ISOLATION] 暂停刷新局限于所属 endpoint
- **WHEN** company 的全部暂停模型被撤销
- **THEN** 真实宿主 company 模型列表已更新，而另一已启用 endpoint 的模型清单保持不变
