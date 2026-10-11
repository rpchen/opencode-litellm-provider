# provider-diagnostics Specification

## Purpose
Defines OpenCode LiteLLM diagnostics from discovery state through command, RPC event, TUI store and rendered card, including safe cache, metadata, protocol, provenance, and failure summaries.

## Requirements

### Requirement: user-invokable TUI diagnostics
The plugin SHALL register litellm-diagnostics and SHALL display its result through plugin RPC/TUI without sending a model request.

#### Scenario: run after successful discovery
- **WHEN** the command executes for a session
- **THEN** the TUI displays status, registered model count, cache source, models.dev statistics, protocol fallback count and Core provenance

### Requirement: lifecycle cache visibility
The plugin SHALL distinguish persisted snapshot restore, network confirmation, short in-memory cache reuse and stale fallback.

#### Scenario: endpoint-compatible restore
- **WHEN** a persisted snapshot is restored before the network result is available
- **THEN** diagnostics report snapshot source and explain that network confirmation is pending

### Requirement: shared mapping semantics
Production discovery SHALL consume Core diagnostics from the same Core model build that is mapped to OpenCode models.

#### Scenario: protocol fallback
- **WHEN** Core uses a conservative protocol fallback
- **THEN** the registered model keeps that Core protocol and the diagnostic statistics expose the fallback

### Requirement: safe presentation
User-facing diagnostics SHALL NOT expose raw credentials, endpoint URLs, connection identity or raw transport error bodies.

#### Scenario: authentication failure
- **WHEN** discovery is cleared by a 401/403
- **THEN** diagnostics show an authentication category and safe remediation text only

### Requirement: existing audit compatibility
The existing litellm-audit-export command and TUI result card SHALL continue to operate independently of the diagnostics card.

#### Scenario: export after diagnostics
- **WHEN** the user runs diagnostics and later exports an audit report
- **THEN** the shared `completed` RPC event routes diagnostics into the diagnostics store while `latest()` and audit events retain audit-export semantics

### Requirement: Model metadata summary
OpenCode SHALL 默认展示发现/已配置/暂不可用、实际元数据来源、推理支持与可选档位、缺失或冲突字段。MUST NOT 提示models_dev_provider或默认列出候选provider/serving证明；matched消费Core实际采用能力统计。保留endpoint状态、缓存年龄及Runtime Identity短值，command/UI与state同源。

#### Scenario: [T22] 匹配成功
- **WHEN** 16项自动采用models.dev能力
- **THEN** 统计反映实际匹配，不因无声明计0

#### Scenario: [T31] 诊断纵向一致
- **WHEN** 从Core到state再到command/RPC/UI
- **THEN** 来源、档位与注册一致，无内部proof噪音
