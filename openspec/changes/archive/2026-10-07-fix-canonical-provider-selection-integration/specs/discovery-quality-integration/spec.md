# Delta: discovery-quality-integration

## MODIFIED Requirements

### Requirement: OpenCode receives operational limits from capability fallback
OpenCode SHALL preserve non-zero Core token limits selected through models.dev provider fallback, and SHALL expose Core's provider-selection provenance unchanged: OpenCode ranks before OpenRouter, and a fallback selection never rewrites the canonical model identity.

#### Scenario: hy4-preview original provider record is unavailable
- **WHEN** Core selects an OpenCode fallback enrichment record (OpenCode ranks before OpenRouter) and returns positive context/input/output limits
- **THEN** OpenCode preserves those limits unchanged while adding the expected SDK package and preserving explicit LiteLLM prices

#### Scenario: fallback never rewrites the canonical identity
- **WHEN** Core selects an OpenCode or OpenRouter fallback record for a model whose deployment identity is a given canonical model name
- **THEN** the OpenCode host model id and name stay the deployment's own identity (never `opencode/...` or `openrouter/...`)