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

### Requirement: 诊断与 TUI 展示 canonical 与 serving 事实

诊断与 TUI 模型卡片 SHALL 在 Core 提供时展示：canonical identity 与证据、
serving 状态与 provider/record、推理档位状态（`unknown` 显示
`models_dev_provider` 恢复提示）、operator-configuration 键（明确不是
enforcement）、诊断候选、catalog 形状。Core 未提供这些字段时（旧 Core）SHALL
省略对应行，不崩溃、不编造。`serving-record-unresolved` /
`declared-unmatched` SHALL 给出可操作修复行（精确 wire id 或更改 provider 声明）。

#### Scenario: serving 未证明的档位 unknown 附恢复提示

- **WHEN** 某模型 canonical 已证明、serving 未证明、档位 unknown
- **THEN** 诊断/TUI 显示档位 unknown 及恢复提示，不展示任何可选档位

#### Scenario: unresolved serving 给出可操作修复

- **WHEN** 某模型为 `serving-record-unresolved` 或 `declared-unmatched`
- **THEN** 显示 warning 行并列出可精确命中的 SKU 候选
