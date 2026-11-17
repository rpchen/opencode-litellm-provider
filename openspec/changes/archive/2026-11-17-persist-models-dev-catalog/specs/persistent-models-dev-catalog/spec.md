## ADDED Requirements

### Requirement: 成功公开目录跨重启保留
插件 SHALL 将 Core 认定完整的 models.dev 目录按来源 URL 持久化，在进程重启后先复用本地目录；已有模型本地匹配成功时 MUST NOT 为重启请求最新目录。不得保存 endpoint 凭据或 LiteLLM 原始响应。

#### Scenario: 重启后目录离线
- **GIVEN** 上一进程已保存完整目录
- **WHEN** 新进程发现相同模型且 models.dev 不可达
- **THEN** 使用本地完整目录，不发出 models.dev 请求

### Requirement: 最新请求失败保留完整目录
插件 SHALL 在最新请求失败或内容不完整时保留已有完整目录；损坏或来源不符的磁盘内容 SHALL 被忽略。LiteLLM 删除和认证失败的既有撤销行为 MUST 保持。

#### Scenario: 最新请求失败
- **WHEN** 获取最新目录失败且本地已有完整目录
- **THEN** 不覆盖磁盘成功记录，已有模型保留完整配置，新增未命中模型仍保留临时失败重试语义

#### Scenario: 无效缓存与来源隔离
- **WHEN** 磁盘内容损坏或来源 URL 与当前请求不同
- **THEN** 不复用该记录并沿用首次获取流程

#### Scenario: 重启后新增模型元数据暂不可用
- **GIVEN** 本地完整目录可以匹配已有模型但不能匹配新增模型
- **WHEN** 获取最新目录失败，随后服务恢复且 LiteLLM 名称集合不变
- **THEN** 已有模型持续可用，新增模型通过既有临时故障恢复路径重新匹配并发布
