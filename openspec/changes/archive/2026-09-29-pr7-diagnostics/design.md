# Design

- Production discovery uses Core diagnoseModelSpecs and then adds OpenCode-only package metadata; injected test builders keep their existing behavior.
- ProviderSnapshot carries a safe diagnostic snapshot separately from provider registration and audit-export state.
- Cache state distinguishes snapshot restore, network, memory-cache and stale last-known-good.
- litellm-diagnostics emits formatted lines over the existing audit RPC registration; the TUI listens for a diagnostics event and renders a dedicated card.
- No session.prompt call is used for diagnostics, so invoking the command does not create a model turn.
- Package version and Core SHA are read from shipped package metadata/provenance; no endpoint URL, credential or raw transport exception is included.
