# publication Specification (OpenCode adapter)

## Purpose
OpenCode consumes the Core trustworthy-publication verdicts without
reimplementing policy: only configured, LKG-configured, or explicitly
degraded models register; host tool flags stay conservative; failures
never produce pseudo-complete models; acceptance stays labeled degraded.

## ADDED Requirements

### Requirement: Publication partition governs registration
The plugin SHALL register only models Core reports as `configured`,
`configured-lkg`, or user-accepted `degraded`, and SHALL keep every
other discovered model out of OpenCode registration with its status and
gaps visible in diagnostics.

#### Scenario: Complete models register normally
- **WHEN** discovery returns Core-configured models
- **THEN** they register with correct limits, capabilities, variants, and protocol packages

#### Scenario: Incomplete models never disguise as normal
- **WHEN** a discovered model is missing limits or has unknown key capabilities
- **THEN** it does not register and diagnostics names its status plus missing/unknown/illegal fields

#### Scenario: Operational guard stays as second layer
- **WHEN** any spec with non-positive context or output reaches the host mapper
- **THEN** it is excluded from registration regardless of publication state

### Requirement: Conservative host tool mapping
The plugin SHALL map `unknown` tool support to disabled on degraded
entries and SHALL never enable host tool calling from unevidenced metadata.

#### Scenario: Degraded entry with unknown tools
- **WHEN** a user-accepted degraded model has unknown tool support
- **THEN** its registered capabilities disable tools while diagnostics still reports tools unknown

### Requirement: Failures and LKG are visible and safe
The plugin SHALL classify metadata failures with the Core taxonomy,
SHALL substitute only valid LKG snapshots (identity/schema/conflict
checked, never TTL-expired), and SHALL show live-vs-LKG selection,
failure kind, and retry state in diagnostics.

#### Scenario: Live failure with valid LKG
- **WHEN** the metadata source fails but a provably belonging complete snapshot exists
- **THEN** the model still registers with LKG provenance and diagnostics marks the LKG selection with age and reason

#### Scenario: Live failure without valid LKG
- **WHEN** no valid snapshot exists
- **THEN** the model stays in discovered-but-incomplete state with the failure kind visible, and no default-filled model registers

#### Scenario: Retry recovery
- **WHEN** a retry fetch returns complete trustworthy metadata
- **THEN** the model returns to normally configured state

#### Scenario: Snapshot persists only normally publishable specs
- **WHEN** a discovery round completes with degraded entries present
- **THEN** the persisted snapshot holds publishable non-degraded specs only

### Requirement: Explicit degraded acceptance over RPC
The plugin SHALL expose explicit user acceptance over RPC that keeps
the degraded label with remaining gaps and SHALL never re-label such
models as fully configured.

#### Scenario: Accept degraded model
- **WHEN** the user accepts a blocked model through the publication RPC
- **THEN** the model registers on the degraded path on the next refresh and diagnostics still lists it as degraded with its gaps

#### Scenario: Degraded model is distinguishable
- **WHEN** diagnostics lines are displayed (command output and TUI)
- **THEN** degraded models are listed separately from fully configured models
