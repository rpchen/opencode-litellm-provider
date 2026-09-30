# multi-endpoint-activation delta

## ADDED Requirements

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
