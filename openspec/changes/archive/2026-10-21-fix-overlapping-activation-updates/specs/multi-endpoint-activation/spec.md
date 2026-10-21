## ADDED Requirements

### Requirement: Overlapping activation updates preserve earlier changes

The plugin MUST serialize reading the current activation, computing the requested change, persisting it and reconciling the runtime in the same operation.

#### Scenario: [ACT-CONCURRENT-TOGGLES] Enable different endpoints concurrently

- **GIVEN** company 和 personal 均已配置凭据且全部停用
- **WHEN** 两个启用 toggle 请求重叠执行
- **THEN** 两个 endpoint 均被保留在持久化启用集合中
- **AND** 管理状态均为期望启用，二者的 provider 模型均被发布
