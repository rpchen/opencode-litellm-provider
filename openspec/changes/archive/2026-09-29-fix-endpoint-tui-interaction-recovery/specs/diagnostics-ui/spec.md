# diagnostics-ui delta

## ADDED Requirements

### Requirement: diagnostics command output survives startup listener races
The terminal TUI SHALL recover the latest diagnostics result if the live completion event was emitted before the TUI listener became ready.

#### Scenario: diagnostics event is missed during startup
- **WHEN** `/litellm-diagnostics` completes before the terminal TUI subscribes to the completion event
- **THEN** the next `auditRpc.latest()` refresh returns that diagnostics result including its lines
- **AND** the diagnostics card becomes visible without executing the command again
- **AND** the recovery does not create a model turn
