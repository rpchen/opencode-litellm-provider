# canonical-name-redirect-integration Specification

## Purpose

确保插件消费共享Core的明确同名canonical关系，并在成功刷新后将正确输出额度传递给宿主注册、诊断和持久化。

## Requirements

### Requirement: Consume canonical name redirects without host-side matching
插件 SHALL 只消费共享Core发布结果，不复制模型匹配算法；成功网络发现后注册与持久化的输出额度必须来自选中官方整记录，context窗口大于output时仍保持独立输出额度。

#### Scenario: [REDIRECT-HOST] 旧错误额度经成功刷新被替换
- **WHEN** 旧快照output=943718，目录精确同名关系指向现存新版canonical，官方对应记录context=1048576/output=393216
- **THEN** 新运行实例成功发现后注册、诊断及持久化反映官方记录，output=393216，保留原模型请求名，不拼LiteLLM字段。
