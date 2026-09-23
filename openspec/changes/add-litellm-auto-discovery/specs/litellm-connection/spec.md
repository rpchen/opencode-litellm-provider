## Purpose

定义用户如何把任意一个 LiteLLM 实例接入 OpenCode：在连接界面填写地址与 API Key，凭据如何被使用与保护，以及多个实例如何并存。

## ADDED Requirements

### Requirement: 通过连接表单接入 LiteLLM
插件 SHALL 在 OpenCode 中注册一个 LiteLLM integration，提供 API Key 认证方式；该方式的表单 MUST 包含必填的 LiteLLM 地址字段（URI 格式）。用户提交后，插件 SHALL 使用该地址与 Key 完成发现，无需编辑任何配置文件。

#### Scenario: 首次连接
- **WHEN** 用户在 OpenCode 连接界面选择 LiteLLM，填写地址 `http://litellm.example:4000` 与 API Key 并提交
- **THEN** 插件使用该地址与 Key 发现模型，模型出现在 OpenCode 模型选择器的 LiteLLM provider 下

#### Scenario: 地址未填写
- **WHEN** 用户只填写 API Key、未填写地址即提交
- **THEN** 宿主的表单校验拒绝提交，不创建凭据

### Requirement: 地址规范化
插件 SHALL 接受带或不带 `/v1` 后缀、带或不带末尾斜杠的地址，并规范化为同一个 LiteLLM 根地址后用于发现与模型调用。

#### Scenario: 用户填写带 /v1 的地址
- **WHEN** 用户填写 `http://litellm.example:4000/v1/`
- **THEN** 发现请求发往 `http://litellm.example:4000/v1/model/info`，模型调用发往 `http://litellm.example:4000/v1/...`，不出现重复的 `/v1/v1`

### Requirement: 发现与调用使用同一把用户 Key
插件 MUST 使用用户在连接中提供的 API Key 进行发现，并使用同一把 Key 进行模型调用；插件 MUST NOT 要求或使用任何额外的管理员 Key。

#### Scenario: 团队 Key 只看到团队模型
- **WHEN** 用户的 Key 只被授权访问团队模型集合 A
- **THEN** 注册的模型集合不超出 A 中实际存在部署的模型

### Requirement: 凭据保密
插件 MUST NOT 把 API Key 写入日志、错误信息、插件缓存文件或任何 OpenCode 配置文件；错误信息中出现的 Key MUST 被脱敏。

#### Scenario: 发现请求失败
- **WHEN** 发现请求返回 401
- **THEN** 插件记录的错误中包含地址与状态码，但不包含 Key 明文

### Requirement: 多个 LiteLLM 实例并存
插件 SHALL 支持通过插件配置声明多个实例（每个实例有唯一 id 与显示名）；每个实例 SHALL 对应一个独立的 integration 与 provider，彼此的连接、模型与刷新互不影响。未声明任何实例时，插件 SHALL 提供一个默认实例（id `litellm`，显示名 `LiteLLM`）。

#### Scenario: 两个实例
- **WHEN** 插件配置声明实例 `litellm-prod` 与 `litellm-lab`，用户分别连接
- **THEN** 模型选择器中出现两个 provider，各自只包含对应实例发现的模型

### Requirement: 切换连接时不混用旧结果
当同一实例的活动连接被替换（换 Key 或换地址）时，插件 MUST NOT 让上一个连接发现的模型继续可用，直到新连接的发现完成。

#### Scenario: 更换 Key
- **WHEN** 用户把实例的 Key 从 K1 换成 K2
- **THEN** 只由 K1 可见的模型从模型选择器中消失，K2 的发现结果就绪后注册其模型

### Requirement: 断开连接
当实例没有活动连接时，插件 SHALL 不为该实例注册任何模型，并停止对该实例的轮询。

#### Scenario: 用户删除凭据
- **WHEN** 用户在 OpenCode 中移除 LiteLLM 连接
- **THEN** 该实例的模型从模型选择器中消失，插件不再向该地址发起发现请求
