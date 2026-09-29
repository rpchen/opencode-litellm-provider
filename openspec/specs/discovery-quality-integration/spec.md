# discovery-quality-integration Specification

## Purpose
Defines how OpenCode preserves discovery-quality semantics selected by Core, including distinct token limits and neutral metadata, while adding only OpenCode-specific SDK package mapping.

## Requirements

### Requirement: OpenCode preserves Core token-limit semantics
OpenCode SHALL adapt PR8 Core model metadata without collapsing total context and maximum input into one value.

#### Scenario: Core context and input limits differ
- **WHEN** PR8 Core returns different `limit.context` and `limit.input` values for a discovered model
- **THEN** the OpenCode model preserves both values unchanged while adding only the host SDK package mapping

### Requirement: OpenCode receives operational limits from capability fallback
OpenCode SHALL preserve non-zero Core token limits selected through models.dev provider fallback.

#### Scenario: hy4-preview original provider record is unavailable
- **WHEN** Core selects the OpenRouter hy4-preview enrichment record and returns positive context/input/output limits
- **THEN** OpenCode preserves those limits unchanged while adding the expected SDK package and preserving explicit LiteLLM prices

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
