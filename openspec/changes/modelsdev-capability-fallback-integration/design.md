# Design

- OpenCode keeps provider selection in Core and only adapts the neutral ModelSpec.
- Core-selected context/input/output limits survive host adaptation unchanged.
- A vertical regression test uses hy4-preview with OpenRouter and OpenCode records and asserts positive operational limits plus the expected OpenCode SDK package.
- Explicit LiteLLM prices remain authoritative through the fallback.
