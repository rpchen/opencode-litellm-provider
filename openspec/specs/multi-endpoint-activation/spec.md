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
The plugin SHALL keep diagnostics, activation, and audit command results visible in the TUI when explicit multi-endpoint mode is configured.

#### Scenario: command executes after multi-endpoint setup
- **WHEN** an explicit multi-endpoint configuration loads successfully and the user executes a LiteLLM command
- **THEN** the server RPC/event path reaches the TUI result card without requiring a model turn

### Requirement: fixed endpoint authentication methods are schema-valid
For an endpoint whose base URL is already fixed by plugin configuration, the plugin SHALL register a key authentication method without an empty form. If a form is present, it SHALL contain at least one valid host form field.

#### Scenario: fixed baseUrl endpoint appears in connect
- **WHEN** `default` and `company` have configured base URLs
- **THEN** real OpenCode 2.0.16 `integration.list` returns both integrations without schema validation failure
- **AND** each integration exposes a key method with no `form: []`

### Requirement: supported OpenCode releases have a real-host delivery gate
The plugin SHALL exercise the delivered Git package against a pinned real supported OpenCode host, not only simulated host contexts.

#### Scenario: real OpenCode 2.0.16 multi-endpoint delivery
- **WHEN** CI installs the current fixed Git commit through OpenCode's own plugin installer and starts a real 2.0.16 server
- **THEN** the LiteLLM server plugin becomes active
- **AND** `litellm` and `litellm-company` integrations are visible
- **AND** independent credentials can be stored for both integrations
- **AND** both endpoint providers become available
- **AND** real `opencode models` lists both provider namespaces
- **AND** the LiteLLM endpoint, diagnostics, and audit commands are registered

### Requirement: endpoint credential isolation is proven against real HTTP discovery
The real-host gate SHALL use distinct endpoint credentials and SHALL fail if credentials are crossed or shared incorrectly.

#### Scenario: two endpoints receive their own key
- **WHEN** different keys are saved for `litellm` and `litellm-company`
- **THEN** each fake LiteLLM endpoint accepts at least one authenticated discovery request using only its expected key
