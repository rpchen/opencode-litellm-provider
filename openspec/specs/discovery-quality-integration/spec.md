# discovery-quality-integration Specification

## Purpose
Defines how OpenCode preserves discovery-quality semantics selected by Core, including distinct token limits and neutral metadata, while adding only OpenCode-specific SDK package mapping.

## Requirements

### Requirement: OpenCode preserves Core token-limit semantics
OpenCode SHALL adapt PR8 Core model metadata without collapsing total context and maximum input into one value.

#### Scenario: Core context and input limits differ
- **WHEN** PR8 Core returns different `limit.context` and `limit.input` values for a discovered model
- **THEN** the OpenCode model preserves both values unchanged while adding only the host SDK package mapping
