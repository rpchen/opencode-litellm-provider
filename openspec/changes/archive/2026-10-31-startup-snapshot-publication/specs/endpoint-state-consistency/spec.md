## MODIFIED Requirements

### Requirement: Canonical endpoint state model

The plugin SHALL derive every user-visible endpoint state from a canonical, four-dimension model (desired / validation / credential / applied) that is a pure function of its inputs. The plugin MUST NOT persist applied/connected flags into user configuration, and MUST NOT collapse the four dimensions into a single boolean.

#### Scenario: [STATE-DESIRED-ENABLED-INVALID] Enabled endpoint with invalid configuration

- **GIVEN** an entry in `plugins[].options.endpoints` with a malformed `baseUrl`
- **WHEN** the user enables the endpoint
- **THEN** the canonical state is `desired=enabled ∧ validation.kind=invalid`
- **AND** the user-visible status is `Enabled · Invalid configuration`
- **AND** the endpoint remains listed in `/litellm-endpoints`, endpoint detail and `/litellm-diagnostics`

#### Scenario: [STATE-DISABLED-INVALID] Disabled endpoint with invalid configuration

- **GIVEN** an entry in `plugins[].options.endpoints` with a malformed `baseUrl`
- **WHEN** the endpoint is disabled
- **THEN** the user-visible status is `Disabled · Invalid configuration`
- **AND** the endpoint remains listed in `/litellm-endpoints`, endpoint detail and `/litellm-diagnostics`

#### Scenario: [STATE-ENABLED-NEEDS-AUTH] Enabled endpoint without a credential

- **GIVEN** an endpoint with a valid `baseUrl` and no stored API key and no usable environment credential
- **WHEN** the user enables the endpoint
- **THEN** the user-visible status is `Enabled · Needs authentication`
- **AND** the next step offered is "Connect API Key" / `/connect`, not a configuration fix

#### Scenario: [STATE-ENABLED-NOT-APPLIED] Enabled endpoint whose runtime apply has not yet succeeded

- **GIVEN** a valid, credential-equipped endpoint without a compatible snapshot that has just been enabled in a fresh process
- **WHEN** the user opens `/litellm-endpoints` or `/litellm-diagnostics <id>`
- **THEN** the user-visible status is `Enabled · Not applied` until a refresh in this process has succeeded

#### Scenario: [STATE-ENABLED-ERROR] Enabled endpoint whose last apply failed

- **WHEN** the most recent refresh for an enabled endpoint without a published snapshot fails with category `credential-missing | config-invalid | auth | network | parse`
- **THEN** the user-visible status is `Enabled · Error` and diagnostics reports the category and sanitised message

#### Scenario: [STATE-ENABLED-ACTIVE] Enabled, valid, authenticated endpoint with a successful apply

- **WHEN** an enabled endpoint has completed at least one successful refresh in this process and the resulting provider/registration view was submitted to the host
- **THEN** the user-visible status is `Enabled · Active` and `models = N` reflects the currently registered runtime models

#### Scenario: [STATE-DISABLED] Plain disabled endpoint

- **WHEN** an endpoint is disabled and its configuration is valid
- **THEN** the user-visible status is `Disabled`

#### Scenario: [STATE-SNAPSHOT] 快照待确认

- **WHEN** 兼容的上次成功快照已发布但本次网络发现尚未成功
- **THEN** 状态显示“来自上次快照、待确认”，不标为“已生效”


### Requirement: `/models` only reflects actually applied runtime models

`applyProvider` SHALL publish a provider/model view only when `desired=enabled ∧ validation=ok ∧ credential∈{stored, environment} ∧ applied.kind∈{active, snapshot}`. Otherwise no `editor.add` happens for that endpoint, and the host's `/models` reflects nothing for it.

#### Scenario: [MODELS-HIDE-DISABLED] Disabled endpoint's models disappear from `/models`

- **WHEN** a previously Active endpoint is disabled
- **THEN** the runtime registration is removed, `applyProvider` chooses not to add, and `/models` no longer lists its models

#### Scenario: [MODELS-HIDE-UNAPPLIED] Apply-failed endpoint's models disappear from `/models`

- **GIVEN** an enabled endpoint whose most recent apply failed without a published compatible snapshot
- **WHEN** `/models` is queried
- **THEN** no model attributed to that endpoint's provider id is listed, even if a historical snapshot exists

#### Scenario: [MODELS-HIDE-INVALID] Invalid endpoint never publishes models

- **WHEN** an endpoint's configuration is invalid
- **THEN** no registration is attempted and `/models` has no entry for it

#### Scenario: [MODELS-SNAPSHOT-GATE] Persisted snapshot is gated by the same four dimensions

- **GIVEN** a persisted discovery snapshot scoped to endpoint `E`
- **WHEN** `E` is disabled, invalid, or has no credential when the loop considers a restore
- **THEN** the snapshot is not used to populate the registered model view

### Requirement: Manual retry

Endpoints whose `desired=enabled` but `applied.kind ∈ {not-applied, error, snapshot}` SHALL expose an explicit "Retry / 重新应用" action in endpoint detail (TUI) and an `endpointRpc.trigger` handler (server side). Retry SHALL trigger a forced refresh of that endpoint only, SHALL NOT require a disable→enable cycle, and SHALL leave desired state unchanged.

#### Scenario: [RETRY-SUCCESS] Retry reconciles to Active

- **GIVEN** an `Enabled · Not applied` or `Enabled · Error` endpoint
- **WHEN** the user chooses Retry and the next refresh succeeds
- **THEN** the user-visible status becomes `Enabled · Active` and `/models` shows the endpoint's models

#### Scenario: [RETRY-NO-OP-FOR-DISABLED] Retry is not offered for disabled or invalid endpoints

- **WHEN** an endpoint is `Disabled`, `Disabled · Invalid configuration` or `Enabled · Invalid configuration`
- **THEN** the Retry action is not offered in endpoint detail and `endpointRpc.trigger` refuses with `code=invalid-state`
