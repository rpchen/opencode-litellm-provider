# endpoint-state-consistency Specification

## Purpose

Defines the canonical per-endpoint state (desired × validation × credential × applied) that the OpenCode plugin uses as the single source of truth for every user-visible surface — `/litellm-endpoints`, endpoint detail, `/litellm-diagnostics` and the providers/models handed to the host via `applyProvider`. It exists so configuration (what the user asked for) and runtime (what is actually applied) never blur into one another, so an apply failure can never silently flip a user's desired state, and so `/models` only ever promises what is really registered.

## Requirements

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

- **GIVEN** a valid, credential-equipped endpoint that has just been enabled in a fresh process or whose last refresh failed
- **WHEN** the user opens `/litellm-endpoints` or `/litellm-diagnostics <id>`
- **THEN** the user-visible status is `Enabled · Not applied` until a refresh in this process has succeeded

#### Scenario: [STATE-ENABLED-ERROR] Enabled endpoint whose last apply failed

- **WHEN** the most recent refresh for an enabled endpoint fails with category `credential-missing | config-invalid | auth | network | parse`
- **THEN** the user-visible status is `Enabled · Error` and diagnostics reports the category and sanitised message

#### Scenario: [STATE-ENABLED-ACTIVE] Enabled, valid, authenticated endpoint with a successful apply

- **WHEN** an enabled endpoint has completed at least one successful refresh in this process and the resulting provider/registration view was submitted to the host
- **THEN** the user-visible status is `Enabled · Active` and `models = N` reflects the currently registered runtime models

#### Scenario: [STATE-DISABLED] Plain disabled endpoint

- **WHEN** an endpoint is disabled and its configuration is valid
- **THEN** the user-visible status is `Disabled`

### Requirement: Validation uses one rule end-to-end

Endpoint id and URL validation SHALL share the same rule as the shared core (`isEndpointID` / `normalizeLiteLLMURL`), exposed through `src/endpoint-input.ts`. The adapter SHALL NOT introduce extra URL heuristics beyond that rule, and SHALL NOT silently fix invalid input.

#### Scenario: [VALIDATION-CONSISTENCY] A URL accepted in the TUI Add/Edit prompt is acceptable to runtime apply

- **WHEN** the user enters a `baseUrl` the prompt accepts
- **THEN** runtime apply does not reject the same value as `config-invalid`

#### Scenario: [VALIDATION-INVALID-PRESERVED] Invalid endpoint stays in the registry

- **WHEN** the declaring config file contains an endpoint whose `baseUrl` fails validation
- **THEN** `parseOptions` keeps the entry with `validation.kind=invalid` and a human-readable `reason`
- **AND** the endpoint remains visible in management, diagnostics and audit output

### Requirement: Credential state is not "connected"

Credential state SHALL be reported as one of `stored`, `environment`, `none` or `unknown`. UI copy MUST NOT call a stored credential "connected"; storage alone does not imply reachability or successful authentication.

#### Scenario: [CRED-STORED-LABEL] Stored key is labelled "saved", not "connected"

- **WHEN** an endpoint has a saved credential
- **THEN** the management UI shows the credential as "已保存 API Key" (or the documented equivalent)
- **AND** no label, summary or notification claims "已连接"/"connected" based on storage alone

#### Scenario: [CRED-MISSING-IS-NOT-INVALID] Missing credential is not an invalid configuration

- **WHEN** an enabled endpoint has no stored credential
- **THEN** the user-visible status is `Enabled · Needs authentication`, not `Enabled · Invalid configuration`, and not `Disabled`

### Requirement: `/models` only reflects actually applied runtime models

`applyProvider` SHALL publish a provider/model view only when `desired=enabled ∧ validation=ok ∧ credential∈{stored, environment} ∧ applied.kind=active`. Otherwise no `editor.add` happens for that endpoint, and the host's `/models` reflects nothing for it.

#### Scenario: [MODELS-HIDE-DISABLED] Disabled endpoint's models disappear from `/models`

- **WHEN** a previously Active endpoint is disabled
- **THEN** the runtime registration is removed, `applyProvider` chooses not to add, and `/models` no longer lists its models

#### Scenario: [MODELS-HIDE-UNAPPLIED] Apply-failed endpoint's models disappear from `/models`

- **GIVEN** an enabled endpoint whose most recent apply failed
- **WHEN** `/models` is queried
- **THEN** no model attributed to that endpoint's provider id is listed, even if a historical snapshot exists

#### Scenario: [MODELS-HIDE-INVALID] Invalid endpoint never publishes models

- **WHEN** an endpoint's configuration is invalid
- **THEN** no registration is attempted and `/models` has no entry for it

#### Scenario: [MODELS-SNAPSHOT-GATE] Persisted snapshot is gated by the same four dimensions

- **GIVEN** a persisted discovery snapshot scoped to endpoint `E`
- **WHEN** `E` is disabled, invalid, or has no credential when the loop considers a restore
- **THEN** the snapshot is not used to populate the registered model view

### Requirement: Apply-failure does not silently revert desired state

When runtime apply fails for a desired=enabled endpoint, persisted activation SHALL remain enabled. Canonical state keeps `desired=enabled` with `applied.kind=error`/`not-applied`. The UI shows the failure markers, never fake success, and never automatically switches the endpoint back to `Disabled`.

#### Scenario: [DESIRED-PERSISTED-ENABLED] Persisted desired state survives apply failure

- **WHEN** enabling an endpoint persists successfully but the runtime apply throws
- **THEN** `litellm.activation.v1` still records that endpoint as enabled
- **AND** the UI shows `Enabled · Not applied` or `Enabled · Error`, never `Disabled`

#### Scenario: [DESIRED-NO-SILENT-ROLLBACK] Apply failure never reports fake success

- **WHEN** runtime apply fails after a user enables an endpoint
- **THEN** no success notification claims the endpoint is Active
- **AND** diagnostics reports the apply failure category instead

### Requirement: Manual retry

Endpoints whose `desired=enabled` but `applied.kind ∈ {not-applied, error}` SHALL expose an explicit "Retry / 重新应用" action in endpoint detail (TUI) and an `endpointRpc.trigger` handler (server side). Retry SHALL trigger a forced refresh of that endpoint only, SHALL NOT require a disable→enable cycle, and SHALL leave desired state unchanged.

#### Scenario: [RETRY-SUCCESS] Retry reconciles to Active

- **GIVEN** an `Enabled · Not applied` or `Enabled · Error` endpoint
- **WHEN** the user chooses Retry and the next refresh succeeds
- **THEN** the user-visible status becomes `Enabled · Active` and `/models` shows the endpoint's models

#### Scenario: [RETRY-NO-OP-FOR-DISABLED] Retry is not offered for disabled or invalid endpoints

- **WHEN** an endpoint is `Disabled`, `Disabled · Invalid configuration` or `Enabled · Invalid configuration`
- **THEN** the Retry action is not offered in endpoint detail and `endpointRpc.trigger` refuses with `code=invalid-state`

### Requirement: Diagnostics endpoint detail never degrades to placeholder

`/litellm-diagnostics <endpoint-id>` SHALL output a complete per-endpoint record for every configured endpoint, regardless of desired/validation/credential/applied state. The record SHALL include at least: the user-visible status, the four canonical dimensions, the most recent error category and sanitised message if any, the last successful discovery time if any, and the currently registered model count.

#### Scenario: [DIAG-DETAIL-DISABLED] Disabled endpoint has full detail

- **WHEN** `/litellm-diagnostics <id>` is invoked on a disabled endpoint
- **THEN** the output includes desired=disabled, validation, credential, applied state and the last error/discovery fields, not a "未激活 · models=0" placeholder

#### Scenario: [DIAG-DETAIL-INVALID] Invalid endpoint has full detail

- **WHEN** `/litellm-diagnostics <id>` is invoked on an endpoint whose configuration is invalid
- **THEN** the output explains the reason and shows `Enabled · Invalid configuration` or `Disabled · Invalid configuration`

#### Scenario: [DIAG-DETAIL-NEEDS-AUTH] Enabled without credential has full detail

- **WHEN** `/litellm-diagnostics <id>` is invoked on an `Enabled · Needs authentication` endpoint
- **THEN** the output states the credential is missing and the next step is to connect a key

### Requirement: State consistency across management, diagnostics and runtime

At any instant, `/litellm-endpoints`, endpoint detail, `/litellm-diagnostics`, `/models`, the actual provider registration and the runtime's registered models MUST agree on the same user-visible status for the same endpoint. No surface may derive its own ad-hoc truth.

#### Scenario: [CONSISTENCY-ALL-VIEWS] All surfaces agree on the canonical state

- **WHEN** an endpoint is in any of the seven user-visible statuses
- **THEN** `/litellm-endpoints`, endpoint detail title, `/litellm-diagnostics <id>` and the runtime's provider/model registration all reflect that exact status

### Requirement: No regression on existing behaviour

The change MUST NOT reintroduce previously fixed issues: `context.plugin.add is not a function`, an un-interactive `/litellm-endpoints`, `/models` drifting from runtime, diagnostics detail falling back to the overview, models with `limit.context <= 0` or `limit.output <= 0` entering the host, or a saved credential being described as "connected".

#### Scenario: [REGRESSION-MODELS-ZERO-LIMIT] Models with non-positive limits are never published

- **WHEN** Core emits a `ModelSpec` whose `limit.context <= 0` or `limit.output <= 0`
- **THEN** `buildModelSpecs` does not expose it to OpenCode
