# Refresh coordinator adapter

## ADDED Requirements

### Requirement: shared coordinator
The OpenCode discovery loop SHALL use litellm-discovery-core's refresh coordinator for discovery freshness, retry, and last-known-good state.

#### Scenario: successful discovery
- **WHEN** a LiteLLM discovery succeeds
- **THEN** the result and fingerprint are stored in Core coordinator state under the current connection identity

### Requirement: trigger semantics
The adapter SHALL distinguish explicit refresh triggers from timer-driven polling.

#### Scenario: explicit trigger
- **WHEN** startup, a credential event, or an explicit loop trigger requests discovery
- **THEN** the adapter requests a forced Core refresh

#### Scenario: timer trigger
- **WHEN** the scheduled poll fires
- **THEN** the adapter performs a non-forced Core refresh so TTL and retry backoff can suppress redundant requests

### Requirement: retry scheduling
The adapter SHALL schedule the next timer using Core's remaining retry delay when a backoff is active, otherwise the configured poll interval.

#### Scenario: first degradable failure
- **WHEN** a degradable refresh fails
- **THEN** the next timer is scheduled using the first Core retry delay rather than the full polling interval

### Requirement: stale registration
A degradable refresh failure after success SHALL preserve the current provider registration and mark audit state stale.

#### Scenario: last-known-good
- **WHEN** Core returns a stale result
- **THEN** the adapter does not reload unchanged provider models and records stale audit status

### Requirement: destructive failures
Authentication and exhausted-notfound failures SHALL preserve the existing OpenCode clear-model behavior.

#### Scenario: authentication failure
- **WHEN** discovery fails with an authentication error
- **THEN** Core coordinated state is cleared and the provider is reloaded with an empty model list

### Requirement: identity lifecycle
The adapter SHALL clear obsolete Core coordinator state when the active connection is removed or changes identity.

#### Scenario: connection switch
- **WHEN** the resolved connection identity changes
- **THEN** the previous identity's coordinator state is discarded before the new identity is discovered
