# discovery-resilience-integration Specification

## Purpose
OpenCode 对 Core discovery-resilience 与 trusted-publication 事实的宿主适配：把 publishable / withheld / partial / unusable / regression / LKG 映射为 OpenCode 的 provider 注册、RPC 只读状态与诊断卡片，且不复制任何 Core 判定、不提供任何绕过 publication gate 的用户动作。

## Requirements

### Requirement: Adapter consumes Core publication facts without re-deriving policy
The plugin SHALL consume Core's publication partition, catalog facts, withheld reasons, evidence resolutions, and acknowledgement decision verbatim, and SHALL NOT re-derive completeness, conflict, eligibility, or authority judgments locally.

#### Scenario: Read-only publication RPC
- **WHEN** a client calls the `litellm-publication` RPC
- **THEN** only a read-only `state` method exists; there is no acceptance or override method, and no event can change what is registered

#### Scenario: Conflict-blocked groups stay withheld
- **WHEN** Core reports a model withheld for an unresolved conflict
- **THEN** the model stays unregistered with status and conflict fields visible in diagnostics

### Requirement: Partial catalog availability is published immediately
The plugin SHALL register every model Core reports publishable in the same round, regardless of how many other models are withheld, and SHALL require no user action for that publication.

#### Scenario: Partially available catalog
- **WHEN** Core reports a subset of discovered models publishable and others withheld
- **THEN** the publishable subset registers immediately, is visible in the host model list, and diagnostics reports partial-availability counts with each withheld model's reasons

#### Scenario: Withheld models never enter the host or the snapshot
- **WHEN** a model is withheld
- **THEN** it is absent from the registration view and from the persisted snapshot, and no acceptance state can add it

### Requirement: Withheld availability changes are surfaced appropriately
The plugin SHALL distinguish a previously published model becoming withheld from a newly discovered model that cannot be published. A regression and an unusable catalog SHALL be surfaced through diagnostics naming the affected models and pointing at retry; a first withholding of a newly discovered model SHALL be visible without repeating notifications. Notification suppression SHALL survive host restarts: the plugin SHALL persist the Core-produced publication memory (acknowledgement plus the regression baseline) under a per-endpoint storage key and restore it before the next discovery round, so the same fingerprint observed in a later host process stays quiet while a materially changed problem set is surfaced again. Unreadable persisted memory SHALL be ignored and SHALL NOT change which models are published.

#### Scenario: Regression is visible
- **WHEN** a model the applied catalog published is withheld this round
- **THEN** diagnostics states that the model was previously available and is now withdrawn, with its reason, and the TUI card shows those lines

#### Scenario: Unusable catalog is visible
- **WHEN** discovered models exist and none can be published
- **THEN** diagnostics states that the endpoint is connected but no model can currently be published safely and mentions retry

#### Scenario: Repeated unchanged problems do not spam
- **WHEN** the same withheld model set with the same material reasons is observed again
- **THEN** no repeated notification is produced

#### Scenario: Suppression survives a host restart
- **WHEN** a problem set was surfaced and persisted, and the host restarts with the same fingerprint
- **THEN** the plugin does not surface it again, still lists every withheld model with its reason in diagnostics, and reports that the problem set is already acknowledged

#### Scenario: Material change after a restart is surfaced again
- **WHEN** a restored acknowledgement exists and the withheld set grows or a model's reason materially changes
- **THEN** the plugin surfaces the problem again

#### Scenario: Persisted memory never changes publication
- **WHEN** persisted memory is restored, corrupt, or absent
- **THEN** the registration view and the withheld reasons are identical; only the notification decision differs

### Requirement: Withdrawn models are never silently substituted
The plugin SHALL NOT change the user's model selection or silently route requests to another model when a previously published model becomes withheld, and SHALL keep acknowledgement free of any effect on publication.

#### Scenario: No silent model substitution
- **WHEN** a model becomes withheld while it is the selected model
- **THEN** the plugin reports the withdrawal and requires the user to refresh or pick another model; it never substitutes one automatically

#### Scenario: Acknowledgement only suppresses notifications
- **WHEN** an acknowledgement state exists for the current problem set
- **THEN** the registration view and the withheld reasons are identical to the state without acknowledgement

### Requirement: Trusted LKG is presented as verified configuration
The plugin SHALL present a model published from a trusted snapshot as previously verified configuration, with its provenance and age, and SHALL NOT describe it as a guess, degraded state, or unverified metadata.

#### Scenario: LKG provenance is visible
- **WHEN** a model is published from LKG
- **THEN** diagnostics reports that the current metadata refresh is unavailable, the configuration comes from a previously verified result, and the snapshot's fetch time and age
