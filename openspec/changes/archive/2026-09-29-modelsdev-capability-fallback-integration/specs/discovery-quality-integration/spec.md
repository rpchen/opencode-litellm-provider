# Discovery quality integration

## ADDED Requirements

### Requirement: OpenCode receives operational limits from capability fallback
OpenCode SHALL preserve non-zero Core token limits selected through models.dev provider fallback.

#### Scenario: hy4-preview original provider record is unavailable
- **WHEN** Core selects the OpenRouter hy4-preview enrichment record and returns positive context/input/output limits
- **THEN** OpenCode preserves those limits unchanged while adding the expected SDK package and preserving explicit LiteLLM prices
