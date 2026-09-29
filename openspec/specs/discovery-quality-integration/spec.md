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

### Requirement: OpenCode publishes only operational model limits
OpenCode SHALL NOT register a Core ModelSpec as an active host model when its context or output token limit is non-positive.

#### Scenario: neutral private model has unknown limits
- **WHEN** Core returns a neutral ModelSpec with context or output equal to zero
- **THEN** OpenCode omits it from the host registration view while Core diagnostics remain able to report the discovered model

#### Scenario: valid model accompanies an invalid model
- **WHEN** one Core ModelSpec has positive operational limits and another does not
- **THEN** OpenCode registers the valid model and omits only the non-operational model
