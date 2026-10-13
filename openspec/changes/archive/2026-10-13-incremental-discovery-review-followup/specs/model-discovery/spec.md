# Spec Delta

## ADDED Requirements

### Requirement: Recover transient metadata-withheld models on an unchanged set

OpenCode SHALL reuse Core's incremental recovery candidates. When a prior successful LiteLLM response has a model withheld as `metadata-unavailable` because Core diagnostics reported a degraded models.dev catalog, a later network refresh MAY process that model again even when the `model_name` set is unchanged. Normally registered ProviderSnapshot models MUST remain reused. Stable unmatched, invalid-metadata and discovered-incomplete results MUST NOT cause additional metadata requests on an unchanged set.

#### Scenario: Temporary catalog failure recovers without a model-set change

- **WHEN** a newly added model was withheld as `metadata-unavailable` during a degraded catalog request and a later catalog request succeeds while LiteLLM returns the same `model_name` set
- **THEN** OpenCode reprocesses the withheld model through Core, registers it if configured, and retains existing normally registered models without reprocessing them

#### Scenario: Stable unmatched identity does not retry

- **WHEN** a complete catalog has no matching record for a model and the catalog later gains a matching record while the LiteLLM `model_name` set remains unchanged
- **THEN** OpenCode reuses the prior unmatched result and does not request or reprocess metadata until the model-name set changes
