## MODIFIED Requirements

### Requirement: fixed endpoint authentication methods are schema-valid
For an endpoint whose base URL is already fixed by plugin configuration, the plugin SHALL register a key authentication method without an empty form. If a form is present, it SHALL contain at least one valid host form field.

#### Scenario: fixed baseUrl endpoint appears in connect
- **WHEN** `default` and `company` have configured base URLs
- **THEN** real latest OpenCode `integration.list` returns both integrations without schema validation failure
- **AND** each integration exposes a key method with no `form: []`

### Requirement: supported OpenCode releases have a real-host delivery gate
The plugin SHALL exercise the delivered Git package against a pinned real supported OpenCode host, including the terminal interaction path for user-visible activation behavior.

#### Scenario: real OpenCode 2.0.16 multi-endpoint delivery
- **WHEN** CI installs the current fixed Git commit through OpenCode's own plugin installer and starts a real latest OpenCode server and terminal client
- **THEN** the LiteLLM server plugin becomes active
- **AND** LiteLLM commands can be invoked before endpoint credentials exist without a silent lost-result failure
- **AND** `litellm` and `litellm-company` integrations are visible
- **AND** independent credentials can be stored for both integrations
- **AND** both endpoint providers and model namespaces become available
- **AND** the real terminal selector can disable one endpoint through keyboard input
- **AND** the disabled provider/model namespace disappears while the other remains available
- **AND** the endpoint can be re-enabled through the same terminal path
