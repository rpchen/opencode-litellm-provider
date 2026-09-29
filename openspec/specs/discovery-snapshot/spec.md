# discovery-snapshot Specification

## Purpose
Defines how OpenCode persists and restores endpoint-bound discovery snapshots, validates Core compatibility and integrity, and observes drift without moving host persistence concerns into the shared Core.

## Requirements

### Requirement: durable compatible restore
OpenCode SHALL use plugin-scoped durable storage to restore a Core discovery snapshot when that snapshot is compatible with the current endpoint fingerprint.

#### Scenario: warm startup
- **WHEN** startup finds a compatible persisted snapshot
- **THEN** OpenCode registers the restored models as stale before the network refresh completes

#### Scenario: endpoint mismatch
- **WHEN** the stored snapshot belongs to a different URL, credential, or result-affecting option set
- **THEN** OpenCode does not register its models

### Requirement: neutral persisted models
OpenCode SHALL persist the Core-neutral model representation rather than host-only model fields.

#### Scenario: package reconstruction
- **WHEN** a neutral snapshot is restored
- **THEN** OpenCode reconstructs its protocol package metadata before provider registration

### Requirement: successful refresh persistence
A successful network discovery SHALL create and best-effort persist a new Core snapshot.

#### Scenario: unchanged endpoint and models
- **WHEN** endpoint and model fingerprint are unchanged
- **THEN** OpenCode does not rewrite the durable snapshot solely to update its timestamp

### Requirement: destructive failure invalidation
Authentication and exhausted-notfound failures SHALL invalidate the persisted snapshot for the current endpoint.

#### Scenario: authentication failure
- **WHEN** discovery proves the current credential invalid
- **THEN** OpenCode clears the durable snapshot before exposing an empty provider catalog

### Requirement: storage failure isolation
Snapshot storage failures SHALL NOT fail model discovery or provider registration.

#### Scenario: write failure
- **WHEN** durable storage rejects a snapshot write
- **THEN** OpenCode logs a warning and keeps the successful in-memory discovery result
