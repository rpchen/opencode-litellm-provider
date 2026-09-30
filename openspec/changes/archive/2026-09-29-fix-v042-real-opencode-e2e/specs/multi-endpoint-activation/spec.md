# multi-endpoint-activation delta

## ADDED Requirements

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
