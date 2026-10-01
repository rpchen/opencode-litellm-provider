# endpoint-management Specification

## Purpose
Defines `/litellm-endpoints` as the single management center for globally configured LiteLLM endpoints in the OpenCode plugin: list, add (ID + Base URL), edit (Base URL only), delete with full cleanup, activate/deactivate, and per-endpoint credential management through the host's native TUI dialogs and client credential API, with comment-preserving, atomic edits to the one canonical plugin-options config file.

## Requirements

### Requirement: Unified endpoint management entry
`/litellm-endpoints` SHALL be the management center for global LiteLLM endpoints. It SHALL use the host's real interactive TUI `dialog.select`, `dialog.confirm` and `dialog.prompt` dialogs for every choice, confirmation and text entry, and SHALL NOT emulate menus by printing selectable-looking text.

#### Scenario: [HOST-UI] Interaction uses real host dialogs
- **WHEN** a user runs `/litellm-endpoints` in a real OpenCode TUI session
- **THEN** every choice, confirmation and input is presented through the host's `select` / `confirm` / `prompt` dialogs and the command output contains no fake menu text

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
- **THEN** each line shows `✓`/`○` for active/inactive and Connected/Not connected for its own credential independently

#### Scenario: [LIST-EXTERNAL] Manual configuration change is visible
- **WHEN** the user edits the declaring OpenCode config file (`plugins[].options.endpoints`) by hand between two invocations
- **THEN** the next invocation shows the edited state without restarting OpenCode

#### Scenario: [LIST-LEGACY-GHOST] No ghost default without a legacy address
- **WHEN** the plugin runs in legacy single-endpoint mode with no connected address
- **THEN** the endpoint list shows no `default` row and offers Add instead

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
- **THEN** it is inactive, exposes no provider or model, and shows Not connected

#### Scenario: [ADD-PRESERVE] Existing endpoints are untouched
- **WHEN** an endpoint is added to a configuration with other endpoints and global settings
- **THEN** all other endpoints, their unknown fields, `pollInterval`, `contextTierCap` and unknown top-level fields are preserved, and previously active endpoints stay active

#### Scenario: [ADD-LEGACY] Legacy single-endpoint configuration is migrated with confirmation
- **WHEN** the plugin runs in legacy single-endpoint mode (address entered via `/connect`) and the user adds a second endpoint
- **THEN** the UI asks for confirmation, then moves the connected address and top-level `protocolOverrides` into `options.endpoints.default` (keeping integration id `litellm` and its credential) and adds the new endpoint

#### Scenario: [ADD-ROLLBACK] A failed Add restores the previous activation
- **WHEN** endpoint creation fails (conflict, write failure or a concurrent external edit) after the activation was pinned
- **THEN** the previous activation is restored, the runtime reconciles back to its previous state and the configuration has no new endpoint

### Requirement: Edit endpoint
Edit SHALL change only the Base URL. The endpoint ID SHALL be read-only and rename SHALL NOT exist. Fields the UI does not manage SHALL be preserved byte-for-byte in value.

#### Scenario: [EDIT-URL] Base URL is changed
- **WHEN** the user submits a new valid Base URL for an endpoint
- **THEN** only that endpoint's `baseUrl` changes in the declaring OpenCode config file (`plugins[].options.endpoints`) and a running provider uses the new address

#### Scenario: [EDIT-ID-READONLY] ID cannot be edited
- **WHEN** the user opens an endpoint's edit flow
- **THEN** no ID input is offered and the ID is unchanged afterwards

#### Scenario: [EDIT-PRESERVE] Unmanaged fields are preserved
- **WHEN** an endpoint contains `protocolOverrides` or unknown fields and its Base URL is edited
- **THEN** those fields remain with identical values

#### Scenario: [EDIT-ATOMIC] Failed write leaves no partial result
- **WHEN** validation fails, the file cannot be parsed, or the atomic replace fails
- **THEN** the original file is unchanged and no temporary file remains

#### Scenario: [EDIT-ISOLATED] Other endpoints are unaffected
- **WHEN** one endpoint's Base URL is edited
- **THEN** other endpoints' configuration, activation, credential and snapshot are unchanged

#### Scenario: [LEGACY-MIGRATE] Legacy default is fully manageable through migration
- **WHEN** the default endpoint is in legacy single-endpoint mode (its address lives in the `/connect` credential) and the user runs Edit, Delete, Connect or Replace
- **THEN** the UI offers to migrate the connected address into `options.endpoints.default`, and after confirmation the action completes normally (endpoint id, integration id, saved credential and activation unchanged; no second endpoint definition appears)

### Requirement: Credential management
The management UI SHALL show Connected / Not connected per endpoint and offer Connect, Replace API Key and Disconnect. It SHALL store credentials in the same host credential backend used by `/connect`, SHALL NEVER display an existing key, and SHALL NOT change activation.

#### Scenario: [CRED-CONNECT] Connect a key
- **WHEN** the user enters an API Key for a Not connected endpoint
- **THEN** the key is stored for that endpoint's provider id and the endpoint shows Connected

#### Scenario: [CRED-REPLACE] Replace a key
- **WHEN** the user enters a new key for a Connected endpoint
- **THEN** the stored key is overwritten and discovery uses the new key

#### Scenario: [CRED-DISCONNECT] Disconnect removes only that credential
- **WHEN** the user confirms Disconnect
- **THEN** only that endpoint's credential is removed; the endpoint definition, activation and other endpoints' credentials are unchanged

#### Scenario: [CRED-NO-ECHO] Keys are never echoed
- **WHEN** any credential operation succeeds or fails
- **THEN** no notification, log or dialog text contains the old or new key

#### Scenario: [CRED-ACTIVATION-INDEPENDENT] Credential changes do not alter activation
- **WHEN** a credential is connected, replaced or disconnected on an active or inactive endpoint
- **THEN** the endpoint's activation state is unchanged, and inactive endpoints still accept these operations

#### Scenario: [CRED-CONNECT-CONSISTENT] /connect and the management UI share one credential state
- **WHEN** a key is saved through the management UI or through the host `/connect` credential store
- **THEN** both entry points report the same Connected state and the provider uses that key

#### Scenario: [CRED-INVALID-KEY] Invalid key input is rejected
- **WHEN** the entered key is empty or contains whitespace or control characters
- **THEN** nothing is stored and the existing credential is unchanged

#### Scenario: [CRED-LEGACY-FORM] Legacy key forms get their required url answer
- **WHEN** a key is saved while the integration's key method still carries a required `url` form field
- **THEN** the connect request answers that form with the endpoint address, and a connect without an address is refused instead of sent in a broken form

### Requirement: Activation management
Activation SHALL keep its existing independent semantics and SHALL take effect immediately.

#### Scenario: [ACT-TOGGLE] Activate and deactivate
- **WHEN** the user activates or deactivates an endpoint
- **THEN** its provider is registered or unregistered immediately and the choice is persisted in host plugin storage (`litellm.activation.v1`)

#### Scenario: [ACT-ZERO] Zero active endpoints
- **WHEN** the user deactivates every endpoint
- **THEN** no provider is exposed and the state is valid

#### Scenario: [ACT-CRED-INDEPENDENT] Deactivation keeps credential and snapshot
- **WHEN** an endpoint is deactivated
- **THEN** its credential and persisted snapshot are kept

#### Scenario: [ACT-IMMEDIATE] Provider exposure follows activation at once
- **WHEN** an endpoint with a credential is activated
- **THEN** its models become visible without restarting OpenCode, and they disappear again when it is deactivated

### Requirement: Delete endpoint
Delete SHALL require explicit confirmation and SHALL remove everything the plugin persists for the endpoint identity.

#### Scenario: [DEL-CONFIRM] Confirmation is required
- **WHEN** the user selects Delete
- **THEN** a confirmation dialog states what will be removed before anything changes

#### Scenario: [DEL-CANCEL] Cancelled delete changes nothing
- **WHEN** the user declines or dismisses the confirmation
- **THEN** the endpoint definition, activation, credential and snapshot are unchanged

#### Scenario: [DEL-CLEANUP] Confirmed delete cleans all persisted state
- **WHEN** the user confirms Delete
- **THEN** the endpoint definition, activation entry, stored credential and persisted discovery snapshot (`litellm.discovery.snapshot.v1.<id>`) are removed and its provider is unregistered

#### Scenario: [DEL-ISOLATED] Other endpoints survive
- **WHEN** one endpoint is deleted
- **THEN** every other endpoint keeps its definition, activation, credential and snapshot

#### Scenario: [DEL-NO-GHOST] Re-adding a deleted id starts clean
- **WHEN** an endpoint id is deleted and later added again
- **THEN** it is inactive, Not connected and has no restored models

#### Scenario: [DEL-PARTIAL-FAILURE] Interrupted delete is retryable
- **WHEN** a cleanup step fails before the definition is removed
- **THEN** the endpoint definition still exists so Delete can be retried, and the error is reported

### Requirement: Canonical configuration safety
the declaring OpenCode config file (`plugins[].options.endpoints`) SHALL remain the only endpoint definition. UI writes SHALL be non-destructive, atomic and conflict-checked.

#### Scenario: [CFG-NON-DESTRUCTIVE] Unknown and global fields survive
- **WHEN** the UI performs any write
- **THEN** unknown fields, `pollInterval`, `contextTierCap` and unrelated endpoints are preserved

#### Scenario: [CFG-PARSE-FAIL] Unparseable configuration is not overwritten
- **WHEN** the declaring OpenCode config file cannot be parsed as JSONC or is not an object
- **THEN** mutations are refused with an explanation and the file is unchanged

#### Scenario: [CFG-CONFLICT] Concurrent external edit is detected
- **WHEN** the file changes on disk between the UI's read and its replace
- **THEN** the write is aborted without overwriting the external change

#### Scenario: [CFG-COMMENTS] Comments and formatting survive
- **WHEN** the UI edits `plugins[].options.endpoints` in a JSONC file with comments
- **THEN** comments, formatting and unknown options outside the edited key are preserved

#### Scenario: [CFG-SHADOWED] Options not sourced from the file make management read-only
- **WHEN** the running plugin options differ from the declaring file (for example inline or project configuration wins)
- **THEN** Add / Edit / Delete are refused with an explanation, while activation and credentials remain manageable
