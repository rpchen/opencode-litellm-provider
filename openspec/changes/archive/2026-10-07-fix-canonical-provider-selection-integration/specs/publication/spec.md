# Delta: publication

## MODIFIED Requirements

### Requirement: Publication partition governs registration
OpenCode SHALL register only models Core reports as `configured` or `configured-lkg`, and SHALL keep every other discovered model out of OpenCode registration with its status and complete reason list visible in diagnostics. No user confirmation, acceptance, or override exists or may be added: a withheld model cannot be moved into the published set by any OpenCode action.

#### Scenario: Complete models register normally
- **WHEN** discovery returns Core-configured models
- **THEN** they register with correct limits, input, cost, and protocol mapping

#### Scenario: Incomplete models never disguise as normal
- **WHEN** a discovered model is missing limits or has unknown key capabilities
- **THEN** it does not register and diagnostics names its status plus missing/unknown/illegal fields

#### Scenario: Operational guard stays as second layer
- **WHEN** any spec with non-positive context or output reaches the host mapper
- **THEN** it is excluded from registration regardless of publication state

#### Scenario: Withheld models stay withheld without any user action
- **WHEN** a model is withheld and the user takes no action, or executes any available command
- **THEN** the registration view is unchanged and there is no acceptance method on the publication RPC

#### Scenario: DeepSeek official provider limits reach the OpenCode host model
- **WHEN** the endpoint serves `deepseek-v4.1-flash` and the Core publication resolves the canonical identity `deepseek/deepseek-v4.1-flash` to the official `deepseek` provider record (`selectionSource: canonical-original`, `limit.output = 393216`)
- **THEN** the registered OpenCode model carries `limit.output = 393216` and `limit.context = 1000000`, never the OpenRouter reseller serving limit `943718`

#### Scenario: Reseller fallback conflicts stay withheld
- **WHEN** no official provider record is provable and the fallback-selected OpenRouter record's serving limit conflicts with the endpoint's own declarations
- **THEN** the model is blocked, `limit.output = 943718` never reaches OpenCode registration, and diagnostics report the unresolved conflict

#### Scenario: Fallback never rewrites the canonical identity
- **WHEN** discovery selects a fallback record for a model whose deployment identity is a given canonical model name
- **THEN** the host model id stays the deployment's own identity (never prefixed with the metadata provider namespace)