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
