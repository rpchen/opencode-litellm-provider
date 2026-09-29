# Diagnostics UI

## ADDED Requirements

### Requirement: host-local absolute time
OpenCode SHALL render user-visible diagnostics absolute timestamps in the timezone of the machine running OpenCode while leaving underlying UTC/epoch state unchanged.

#### Scenario: host is UTC+08:00
- **WHEN** a discovery instant is `2026-09-29T01:07:32.160Z` and the host is UTC+08:00
- **THEN** diagnostics display `2026-09-29 09:07:32 UTC+08:00` and preserve the stored instant

#### Scenario: retry time is shown
- **WHEN** diagnostics include a future retry timestamp
- **THEN** that timestamp uses the same host-local format

### Requirement: dismissible diagnostics card
The terminal TUI SHALL let the user dismiss the current session's diagnostics card without issuing a model turn.

#### Scenario: user closes diagnostics
- **WHEN** the user clicks `[关闭]` on a rendered diagnostics card
- **THEN** that diagnostics result disappears and a later diagnostics command may show a newer result

### Requirement: dismissible audit card
The terminal TUI SHALL let the user dismiss the current session's audit result and SHALL NOT resurrect the same result through latest-result polling.

#### Scenario: user closes audit result
- **WHEN** the user clicks `[关闭]` on an audit result and polling returns the same sequence
- **THEN** the card stays hidden

#### Scenario: a newer audit result arrives
- **WHEN** a dismissed session receives a higher audit result sequence
- **THEN** the new result is displayed normally
