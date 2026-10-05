# endpoint-management Specification (delta)

本 delta 只修正既有 requirement 中 credential 状态的**表达**，不新增能力。
`Credential management` 的状态展示语义与 canonical `endpoint-state-consistency`
的 "Credential state is not \"connected\"" 对齐；其余 requirement 仅同步修正
受影响 scenario 的状态标签用词。

## MODIFIED Requirements

### Requirement: Endpoint listing

The management UI SHALL list every configured endpoint with its active state and credential state, reading the canonical configuration on every invocation.

#### Scenario: [LIST-EMPTY] No endpoint configured

- **WHEN** no endpoint is configured
- **THEN** the UI offers "Add endpoint" and does not fail or print an error

#### Scenario: [LIST-SINGLE] Single endpoint

- **WHEN** exactly one endpoint is configured
- **THEN** the UI lists that endpoint with its active and credential state

#### Scenario: [LIST-MULTI] Mixed active and credential states

- **WHEN** several endpoints are configured with different activation and credential states
- **THEN** each line shows `✓`/`○` for active/inactive and the endpoint's own saved/not-saved API Key state independently

#### Scenario: [LIST-EXTERNAL] Manual configuration change is visible

- **WHEN** the user edits the declaring OpenCode config file (`plugins[].options.endpoints`) by hand between two invocations
- **THEN** the next invocation shows the edited state without restarting OpenCode

#### Scenario: [LIST-LEGACY-GHOST] No ghost default without a legacy address

- **WHEN** the plugin runs in legacy single-endpoint mode with no connected address
- **THEN** the endpoint list shows no `default` row and offers Add instead
- **THEN** activation materialised by management actions never contains the internal `default` identity

### Requirement: Add endpoint

Add SHALL ask only for a user-defined endpoint ID and a Base URL. The new endpoint SHALL be inactive and MAY have no credential. Creating an endpoint SHALL NOT activate it.

#### Scenario: [ADD-OK] Valid endpoint is added

- **WHEN** the user enters a valid unused ID and an http(s) Base URL
- **THEN** the plugin options in the declaring OpenCode config file gain that endpoint and the UI reports it as added

#### Scenario: [ADD-DUP] Duplicate ID

- **WHEN** the entered ID already exists in the configuration
- **THEN** the ID is rejected, nothing is written, and the user may enter another ID

#### Scenario: [ADD-BAD-ID] Invalid ID

- **WHEN** the entered ID does not match `[a-z0-9][a-z0-9-_]*`
- **THEN** the ID is rejected and nothing is written

#### Scenario: [ADD-BAD-URL] Invalid Base URL

- **WHEN** the entered Base URL is empty, not http(s), or contains userinfo
- **THEN** the URL is rejected and nothing is written

#### Scenario: [ADD-INACTIVE] Default inactive and unconnected

- **WHEN** an endpoint has just been added
- **THEN** it is inactive, exposes no provider or model, and shows "未保存 API Key"
- **THEN** the activation materialised by the Add contains only configured endpoint definitions — a legacy `default` identity without a connected address is never written into activation

#### Scenario: [ADD-PRESERVE] Existing endpoints are untouched

- **WHEN** an endpoint is added to a configuration with other endpoints and global settings
- **THEN** all other endpoints, their unknown fields, `pollInterval`, `contextTierCap` and unknown top-level fields are preserved, and previously active endpoints stay active

#### Scenario: [ADD-LEGACY] Legacy single-endpoint configuration is migrated with confirmation

- **WHEN** the plugin runs in legacy single-endpoint mode (address entered via `/connect`) and the user adds a second endpoint
- **THEN** the UI asks for confirmation, then moves the connected address and top-level `protocolOverrides` into `options.endpoints.default` (keeping integration id `litellm` and its credential) and adds the new endpoint

#### Scenario: [ADD-ROLLBACK] A failed Add keeps the activation consistent with the committed configuration

- **WHEN** endpoint creation fails before the configuration write commits (conflict, write failure or a concurrent external edit) after the activation was pinned
- **THEN** the previous activation is restored, the runtime reconciles back to its previous state and the configuration has no new endpoint
- **WHEN** the configuration write has committed but the runtime reload afterwards fails
- **THEN** the materialised activation is kept and never restored to `all`, the new endpoint stays inactive in the committed configuration, and the UI reports that the configuration was saved while the runtime reload failed

### Requirement: Credential management

The management UI SHALL show the endpoint's credential state as one of "已保存 API Key" (saved), "未保存 API Key" (not saved), "API Key 来自环境变量" (from environment) or "凭据状态未知" (unknown) per endpoint, and offer Connect, Replace API Key and Disconnect. It SHALL store credentials in the same host credential backend used by `/connect`, SHALL NEVER display an existing key, and SHALL NOT change activation. The labels MUST NOT describe a credential as Connected / Not connected; a saved credential implies neither reachability nor runtime application.

#### Scenario: [CRED-CONNECT] Connect a key

- **WHEN** the user enters an API Key for an endpoint whose credential is not saved
- **THEN** the key is stored for that endpoint's provider id and the endpoint shows "已保存 API Key"

#### Scenario: [CRED-REPLACE] Replace a key

- **WHEN** the user enters a new key for an endpoint with a saved credential
- **THEN** the stored key is overwritten and discovery uses the new key

#### Scenario: [CRED-DISCONNECT] Disconnect removes only that credential

- **WHEN** the user confirms Disconnect
- **THEN** only that endpoint's credential is removed; the endpoint definition, activation and other endpoints' credentials are unchanged

#### Scenario: [CRED-NO-ECHO] Keys are never echoed

- **WHEN** any credential operation succeeds or fails
- **THEN** no notification, log or dialog text contains the old or new key

#### Scenario: [CRED-ACTIVATION-INDEPENDENT] Credential changes do not alter activation

- **WHEN** a key is connected, replaced or disconnected on an active or inactive endpoint
- **THEN** the endpoint's activation state is unchanged, and inactive endpoints still accept these operations

#### Scenario: [CRED-CONNECT-CONSISTENT] /connect and the management UI share one credential state

- **WHEN** a key is saved through the management UI or through the host `/connect` credential store
- **THEN** both entry points report the same saved-credential state and the provider uses that key

#### Scenario: [CRED-INVALID-KEY] Invalid key input is rejected

- **WHEN** the entered key is empty or contains whitespace or control characters
- **THEN** nothing is stored and the existing credential is unchanged

#### Scenario: [CRED-LEGACY-FORM] Legacy key forms get their required url answer

- **WHEN** a key is saved while the integration's key method still carries a required `url` form field
- **THEN** the connect request answers that form with the endpoint address, and a connect without an address is refused instead of sent in a broken form

### Requirement: Delete endpoint

Delete SHALL require explicit confirmation and SHALL remove everything the plugin persists for the endpoint identity.

#### Scenario: [DEL-CONFIRM] Confirmation is required

- **WHEN** the user selects Delete
- **THEN** a confirmation dialog states what will be removed before anything changes

#### Scenario: [DEL-CANCEL] Cancelled delete changes nothing

- **WHEN** the user declines or dismisses the final Delete confirmation
- **THEN** the endpoint definition, activation, credential and discovery snapshot are unchanged
- **THEN** no migration or cleanup has run: Cancel Delete never triggers the legacy migration, `prepareRemove`, `remove` or any credential removal, and the first persistent mutation happens only after the user confirms the deletion

#### Scenario: [DEL-CLEANUP] Confirmed delete cleans all persisted state

- **WHEN** the user confirms Delete
- **THEN** the endpoint definition, activation entry, stored credential and persisted discovery snapshot (`litellm.discovery.snapshot.v1.<id>`) are removed and its provider is unregistered

#### Scenario: [DEL-ISOLATED] Other endpoints survive

- **WHEN** one endpoint is deleted
- **THEN** every other endpoint keeps its definition, activation, credential and snapshot

#### Scenario: [DEL-NO-GHOST] Re-adding a deleted id starts clean

- **WHEN** an endpoint id is deleted and later added again
- **THEN** it is inactive, has no saved credential and has no restored models

#### Scenario: [DEL-PARTIAL-FAILURE] Interrupted delete is retryable

- **WHEN** a cleanup step fails before the definition is removed
- **THEN** the endpoint definition still exists so Delete can be retried, and the error is reported