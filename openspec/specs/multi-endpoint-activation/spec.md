# multi-endpoint-activation Specification

## Purpose
Defines how the OpenCode plugin exposes multiple globally configured LiteLLM endpoints as isolated integrations/providers, manages their independent credentials and activation state, and keeps diagnostics/UI behavior available without unsupported runtime child-plugin APIs.

## Requirements

### Requirement: multiple endpoints run in one supported OpenCode V2 plugin context
The plugin SHALL implement explicit multi-endpoint runtime using public OpenCode V2 integration/provider transforms and SHALL NOT require runtime child-plugin add/remove APIs.

#### Scenario: two explicit endpoints load on a real V2 context shape
- **WHEN** `default` and `company` are configured and the host context does not expose `plugin.add/remove`
- **THEN** plugin setup succeeds and both endpoint integrations are registered

### Requirement: endpoint credentials are independently addressable
Each configured endpoint SHALL have a stable independent integration id so OpenCode can persist and resolve a distinct API Key for each endpoint.

#### Scenario: user connects two endpoint credentials
- **WHEN** the user opens `/connect` for `LiteLLM` and `LiteLLM · company`
- **THEN** credentials are stored and resolved under `litellm` and `litellm-company` independently

### Requirement: activation does not remove credential integrations
Deactivating an endpoint SHALL stop its provider/discovery runtime without deleting the endpoint integration or previously saved credential.

#### Scenario: inactive endpoint remains connectable
- **WHEN** `company` is deactivated
- **THEN** its provider/discovery stops while the `litellm-company` integration remains available for credential management

### Requirement: multi-endpoint commands remain visibly actionable
The plugin SHALL keep diagnostics, activation, and audit command results visibly actionable in the terminal TUI when explicit multi-endpoint mode is configured. Endpoint activation SHALL use a host-native selectable control rather than text that merely looks clickable, and a command executed before the TUI event listener is ready SHALL be recoverable from server state without a model turn.

#### Scenario: command executes after multi-endpoint setup
- **WHEN** an explicit multi-endpoint configuration loads successfully and the user executes a LiteLLM command
- **THEN** the server RPC/event path reaches the TUI result card without requiring a model turn

#### Scenario: command executes immediately after multi-endpoint startup
- **WHEN** an explicit multi-endpoint configuration loads and the user executes a LiteLLM command before or during TUI plugin initialization
- **THEN** the result becomes visible through the live RPC event or subsequent state/latest recovery
- **AND** no model turn is required

#### Scenario: user toggles an endpoint in the terminal selector
- **WHEN** the user opens `/litellm-endpoints`
- **THEN** OpenCode presents a native selectable list containing every configured endpoint plus all/none/close actions
- **AND** host keyboard navigation and Enter can execute the selected action
- **AND** host mouse selection can execute the same action
- **AND** the selector refreshes to show the updated active state until the user closes it

### Requirement: fixed endpoint authentication methods are schema-valid
For an endpoint whose base URL is already fixed by plugin configuration, the plugin SHALL register a key authentication method without an empty form. If a form is present, it SHALL contain at least one valid host form field.

#### Scenario: fixed baseUrl endpoint appears in connect
- **WHEN** `default` and `company` have configured base URLs
- **THEN** real OpenCode 2.0.16 `integration.list` returns both integrations without schema validation failure
- **AND** each integration exposes a key method with no `form: []`

### Requirement: supported OpenCode releases have a real-host delivery gate
The plugin SHALL exercise the delivered Git package against a pinned real supported OpenCode host, including the terminal interaction path for user-visible activation behavior.

#### Scenario: real OpenCode 2.0.16 multi-endpoint delivery
- **WHEN** CI installs the current fixed Git commit through OpenCode's own plugin installer and starts a real 2.0.16 server and terminal client
- **THEN** the LiteLLM server plugin becomes active
- **AND** LiteLLM commands can be invoked before endpoint credentials exist without a silent lost-result failure
- **AND** `litellm` and `litellm-company` integrations are visible
- **AND** independent credentials can be stored for both integrations
- **AND** both endpoint providers and model namespaces become available
- **AND** the real terminal selector can disable one endpoint through keyboard input
- **AND** the disabled provider/model namespace disappears while the other remains available
- **AND** the endpoint can be re-enabled through the same terminal path

### Requirement: endpoint credential isolation is proven against real HTTP discovery
The real-host gate SHALL use distinct endpoint credentials and SHALL fail if credentials are crossed or shared incorrectly.

#### Scenario: two endpoints receive their own key
- **WHEN** different keys are saved for `litellm` and `litellm-company`
- **THEN** each fake LiteLLM endpoint accepts at least one authenticated discovery request using only its expected key

### Requirement: diagnostics endpoint arguments follow the OpenCode command invocation contract
In explicit multi-endpoint mode, the plugin SHALL read the slash-command tail from the OpenCode command invocation and SHALL scope diagnostics to the requested endpoint when a valid endpoint id is supplied.

#### Scenario: user requests one endpoint's diagnostics
- **WHEN** the user executes `/litellm-diagnostics company`
- **THEN** the command reads `company` from the invocation prompt text
- **AND** the diagnostics result starts with `Endpoint：company`
- **AND** the result contains the selected endpoint's detailed diagnostics rather than the multi-endpoint overview

#### Scenario: endpoint argument contains surrounding whitespace
- **WHEN** the command invocation prompt text contains surrounding whitespace around a valid endpoint id
- **THEN** the plugin trims the whitespace before endpoint lookup

#### Scenario: endpoint argument is unknown
- **WHEN** the user supplies an endpoint id that is not configured
- **THEN** diagnostics reports that exact endpoint id as unknown instead of silently falling back to the overview
