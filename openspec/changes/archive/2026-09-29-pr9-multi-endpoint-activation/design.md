# Design

- Endpoint definitions are global only; endpoint ids are user-defined stable ASCII slugs.
- `default` preserves the historical `litellm` identity; non-default endpoints use `litellm-<id>`.
- Activation is global state independent from endpoint definitions and supports `all` or an arbitrary selected set, including zero active endpoints.
- Inactive endpoints stop registration and discovery while preserving credentials and snapshots.
- Legacy single-endpoint credential/snapshot namespaces remain unchanged.
- Discovery quality semantics remain delegated to the shared Core; PR9 adds host orchestration rather than new discovery heuristics.
- OpenCode exposes `/litellm-endpoints` for activation and keeps diagnostics endpoint-aware.
