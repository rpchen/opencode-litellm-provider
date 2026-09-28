# PR6 persisted discovery snapshot adapter

Persist Core discovery snapshots through OpenCode's plugin-scoped durable storage. Restore only endpoint-compatible neutral snapshots before network discovery, refresh them after successful discovery, and surface compatibility drift without moving host lifecycle or provider registration into Core.
