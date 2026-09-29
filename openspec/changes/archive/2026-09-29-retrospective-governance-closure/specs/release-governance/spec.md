# Release governance

## ADDED Requirements

### Requirement: release metadata stays aligned
OpenCode CI SHALL verify that package and lockfile versions match the README current-release fixed-tag example and release-notes reference.

#### Scenario: repository release metadata is consistent
- **WHEN** a release or normal CI candidate is verified
- **THEN** the metadata check succeeds only when manifest, lockfile, README fixed version, README release-notes link, and release-notes file refer to the same version

### Requirement: completed OpenSpec changes are archived
OpenCode CI SHALL reject an active OpenSpec change whose tasks are fully complete.

#### Scenario: completed change remains active
- **WHEN** an active change contains completed tasks and no unchecked tasks
- **THEN** the OpenSpec closure check fails until the change is archived through the OpenSpec workflow
