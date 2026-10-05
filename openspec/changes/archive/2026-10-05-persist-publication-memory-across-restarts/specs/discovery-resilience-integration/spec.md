## MODIFIED Requirements

### Requirement: Withheld availability changes are surfaced appropriately
The plugin SHALL distinguish a previously published model becoming withheld from a newly discovered model that cannot be published. A regression and an unusable catalog SHALL be surfaced through diagnostics naming the affected models and pointing at retry; a first withholding of a newly discovered model SHALL be visible without repeating notifications. Notification suppression SHALL survive host restarts: the plugin SHALL persist the Core-produced publication memory (acknowledgement plus the regression baseline) under a per-endpoint storage key and restore it before the next discovery round, so the same fingerprint observed in a later host process stays quiet while a materially changed problem set is surfaced again. Unreadable persisted memory SHALL be ignored and SHALL NOT change which models are published.

#### Scenario: Regression is visible
- **WHEN** a model the applied catalog published is withheld this round
- **THEN** diagnostics states that the model was previously available and is now withdrawn, with its reason, and the TUI card shows those lines

#### Scenario: Unusable catalog is visible
- **WHEN** discovered models exist and none can be published
- **THEN** diagnostics states that the endpoint is connected but no model can currently be published safely and mentions retry

#### Scenario: Repeated unchanged problems do not spam
- **WHEN** the same withheld model set with the same material reasons is observed again
- **THEN** no repeated notification is produced

#### Scenario: Suppression survives a host restart
- **WHEN** a problem set was surfaced and persisted, and the host restarts with the same fingerprint
- **THEN** the plugin does not surface it again, still lists every withheld model with its reason in diagnostics, and reports that the problem set is already acknowledged

#### Scenario: Material change after a restart is surfaced again
- **WHEN** a restored acknowledgement exists and the withheld set grows or a model's reason materially changes
- **THEN** the plugin surfaces the problem again

#### Scenario: Persisted memory never changes publication
- **WHEN** persisted memory is restored, corrupt, or absent
- **THEN** the registration view and the withheld reasons are identical; only the notification decision differs

