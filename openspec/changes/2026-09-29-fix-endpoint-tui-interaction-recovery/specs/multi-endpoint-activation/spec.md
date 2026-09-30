# multi-endpoint-activation delta

## MODIFIED Requirements

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
