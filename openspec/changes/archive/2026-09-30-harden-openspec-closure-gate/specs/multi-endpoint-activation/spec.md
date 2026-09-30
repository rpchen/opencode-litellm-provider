# Restore archived endpoint requirements

## ADDED Requirements

### Requirement: Global endpoint registry
The plugin SHALL support a global `endpoints` object keyed by stable user-defined endpoint ids and SHALL NOT require project-level endpoint configuration.

#### Scenario: Multiple endpoints are configured
- **WHEN** the global configuration defines `default` and another endpoint
- **THEN** the plugin exposes independent provider identities for both endpoints

### Requirement: Legacy zero-migration behavior
The plugin SHALL map the historical single-endpoint configuration to endpoint `default` and preserve the historical provider, credential and snapshot identity.

#### Scenario: Existing user upgrades
- **WHEN** no explicit `endpoints` object is configured
- **THEN** the legacy LiteLLM setup continues to operate as `default` without a migration step

### Requirement: Independent activation
The plugin SHALL persist activation separately from endpoint definitions and SHALL support all endpoints, an arbitrary selected set, or zero active endpoints.

#### Scenario: Endpoint is deactivated
- **WHEN** a user deactivates one endpoint
- **THEN** that endpoint stops provider registration and discovery without deleting its definition, credential or snapshot

### Requirement: Endpoint isolation
Each endpoint SHALL have independent credentials, discovery coordination, cache, snapshot, diagnostics and failure behavior.

#### Scenario: One endpoint fails
- **WHEN** one active endpoint has an authentication or transport failure
- **THEN** other active endpoints continue using their own state and are not failed over or merged automatically
