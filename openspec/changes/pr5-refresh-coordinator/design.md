# Design

- OpenCode keeps its host event loop and running/queued serialization, but delegates discovery freshness, retry state, and last-known-good handling to Core.
- The coordinator key remains the existing connection identity: connection id/name, normalized URL, and resolved credential key.
- Explicit startup/credential/manual triggers force refresh; timer-driven polling is non-forced and therefore respects Core TTL/backoff.
- Authentication and exhausted-notfound failures clear coordinated state and preserve the existing cleared audit states.
- Degradable failures return last-known-good and set audit status to stale without re-registering unchanged models.
- Retry scheduling uses Core's remaining backoff when present, otherwise the configured poll interval.
- Disconnects and identity switches clear obsolete Core state.
