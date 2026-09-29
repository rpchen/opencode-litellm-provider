# Release governance

## ADDED Requirements

### Requirement: release metadata stays aligned
OpenCode CI SHALL verify that package and lockfile versions, README current-release examples, and current release-notes link/file refer to the same release version.

#### Scenario: repository release metadata is consistent
- **WHEN** a release or normal CI candidate is verified
- **THEN** the release metadata consistency check succeeds only when all current-release metadata refers to the same version
