# OpenCode provider diagnostics

## ADDED Requirements

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
- **THEN** both RPC event channels retain their own latest session result
