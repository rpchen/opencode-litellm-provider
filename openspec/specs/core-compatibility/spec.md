# core-compatibility Specification

## Purpose
Defines how the OpenCode plugin validates an immutable litellm-discovery-core commit through compatibility workflows, complete consumer delivery checks, and provenance evidence before shared Core changes are considered compatible.

## Requirements

### Requirement: OpenCode compatibility entrypoint
The repository SHALL provide manual and `repository_dispatch` compatibility verification for a complete Core SHA.

#### Scenario: valid Core SHA
- **WHEN** the workflow receives a valid `core_sha`
- **THEN** it runs the existing delivery, type, test, rendering, distribution, and package gates against that SHA

#### Scenario: invalid Core SHA
- **WHEN** the workflow receives a missing or malformed SHA
- **THEN** it fails before installing or building
