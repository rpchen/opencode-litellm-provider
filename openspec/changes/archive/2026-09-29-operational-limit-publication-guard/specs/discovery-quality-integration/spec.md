# Discovery quality integration

## ADDED Requirements

### Requirement: OpenCode does not publish non-operational token limits
OpenCode SHALL NOT publish a host model when Core reports a non-positive total context or output token limit.

#### Scenario: context limit is unknown
- **WHEN** a Core ModelSpec has `limit.context <= 0`
- **THEN** OpenCode omits that model from the host model list while Core diagnostics may still retain it

#### Scenario: output limit is unknown
- **WHEN** a Core ModelSpec has `limit.output <= 0`
- **THEN** OpenCode omits that model from the host model list while valid models remain available

#### Scenario: operational limits are valid
- **WHEN** both Core context and output limits are positive
- **THEN** OpenCode preserves the model and adds the normal SDK package mapping
