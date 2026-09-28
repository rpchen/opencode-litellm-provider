# Design

- OpenCode stores one schema-versioned Core snapshot under a plugin-scoped storage key; no user configuration file or ad-hoc filesystem cache is introduced.
- Storage is best-effort. If the host storage domain is unavailable or fails, discovery continues with the existing network/in-memory behavior.
- Snapshot identity includes normalized endpoint URL, credential key, `contextTierCap`, and `protocolOverrides`.
- On startup or identity change, a compatible snapshot is restored before the network request completes and is marked stale until refreshed.
- The persisted models remain Core-neutral: OpenCode's host-only `package` field is stripped before persistence and reconstructed on restore.
- Successful discovery compares the prior compatible snapshot for topology/protocol/capability drift, then persists only when endpoint/model identity changed.
- Authentication and exhausted-notfound failures clear the current persisted snapshot before clearing provider models.
