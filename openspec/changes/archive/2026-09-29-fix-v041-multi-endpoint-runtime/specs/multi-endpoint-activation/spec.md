# Multi-endpoint activation runtime

## ADDED Requirements

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
