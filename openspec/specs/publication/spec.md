# publication Specification

## Purpose
OpenCode consumes the Core trustworthy-publication verdicts without
reimplementing policy: only configured, LKG-configured, or explicitly
degraded models register; host tool flags stay conservative; failures
never produce pseudo-complete models; acceptance stays labeled degraded.

## Requirements

### Requirement: Publication partition governs registration
The plugin SHALL register only models Core reports as `configured` or
`configured-lkg`, and SHALL keep every other discovered model out of
OpenCode registration with its status and complete reason list visible in
diagnostics. No user confirmation, acceptance, or override exists: no
command, RPC method, or stored state may move a withheld model into the
published set.

#### Scenario: Complete models register normally
- **WHEN** discovery returns Core-configured models
- **THEN** they register with correct limits, capabilities, variants, and protocol packages

#### Scenario: Incomplete models never disguise as normal
- **WHEN** a discovered model is missing limits or has unknown key capabilities
- **THEN** it does not register and diagnostics names its status plus missing/unknown/illegal fields

#### Scenario: Operational guard stays as second layer
- **WHEN** any spec with non-positive context or output reaches the host mapper
- **THEN** it is excluded from registration regardless of publication state

#### Scenario: Withheld models stay withheld without any user action
- **WHEN** a model is withheld and the user takes no action, or executes any available command
- **THEN** the registration view is unchanged and there is no acceptance method on the publication RPC

### Requirement: Conservative host tool mapping
The plugin SHALL map `unknown` tool support to disabled and SHALL never
enable host tool calling from unevidenced metadata.

#### Scenario: Degraded entry with unknown tools
- **WHEN** an entry reports unknown tool support
- **THEN** its registered capabilities disable tools while diagnostics still reports tools unknown

### Requirement: Failures and LKG are visible and safe
The plugin SHALL classify metadata failures with the Core taxonomy,
SHALL substitute only valid LKG snapshots (identity/schema/conflict
checked by Core, never TTL-expired), and SHALL show live-vs-LKG
selection with provenance and age, failure kind, retry state, withheld
reasons, and field-level evidence facts. A descriptive LiteLLM metadata
difference Core resolved into a discrepancy SHALL NOT be presented as a
failure and SHALL NOT discard a trusted snapshot.

#### Scenario: Live failure with valid LKG
- **WHEN** the metadata source fails but a provably belonging complete snapshot exists
- **THEN** the model still registers with LKG provenance and diagnostics marks the LKG selection with age and reason

#### Scenario: Live failure without valid LKG
- **WHEN** no valid snapshot exists
- **THEN** the model stays withheld with the failure kind and reason visible, and no default-filled model registers

#### Scenario: Retry recovery
- **WHEN** a retry fetch returns complete trustworthy metadata
- **THEN** the model returns to normally configured state

#### Scenario: Snapshot persists only normally publishable specs
- **WHEN** a discovery round completes with withheld entries present
- **THEN** the persisted snapshot holds publishable specs only, and no withheld or previously accepted model survives into it

#### Scenario: Descriptive discrepancy keeps the trusted snapshot
- **WHEN** Core reports a resolved discrepancy for a model otherwise served from LKG
- **THEN** the model stays registered from the trusted snapshot and diagnostics shows both the discrepancy and the LKG provenance
