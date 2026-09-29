# Discovery quality integration

## ADDED Requirements

### Requirement: OpenCode publishes only operational model limits
OpenCode SHALL NOT register a Core ModelSpec as an active host model when its context or output token limit is non-positive.

#### Scenario: neutral private model has unknown limits
- **WHEN** Core returns a neutral ModelSpec with context or output equal to zero
- **THEN** OpenCode omits it from the host registration view while Core diagnostics remain able to report the discovered model

#### Scenario: valid model accompanies an invalid model
- **WHEN** one Core ModelSpec has positive operational limits and another does not
- **THEN** OpenCode registers the valid model and omits only the non-operational model
