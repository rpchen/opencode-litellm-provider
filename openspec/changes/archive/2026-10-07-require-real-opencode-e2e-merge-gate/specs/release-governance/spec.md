# Delta: release-governance

## MODIFIED Requirements

### Requirement: completed OpenSpec changes are archived
OpenCode CI SHALL reject an active OpenSpec change whose tasks are fully complete.

#### Scenario: completed change remains active
- **WHEN** an active OpenSpec change contains completed tasks and no unchecked tasks
- **THEN** the OpenSpec closure check fails until the change is archived through the OpenSpec workflow

## ADDED Requirements

### Requirement: main merge gate requires both CI and the real host E2E
The `Protect main` ruleset SHALL require both the `CI` and the `Real OpenCode 2.0.16 E2E` status checks as merge conditions, and OpenCode CI SHALL verify the live ruleset against this frozen baseline so a future drift fails the pipeline instead of silently weakening the gate.

The exact required context names are taken from real GitHub Actions check runs (never guessed from workflow job names or YAML files).

#### Scenario: merge gate requires both checks
- **WHEN** the live `Protect main` ruleset is queried from the GitHub ruleset API
- **THEN** its required status checks are exactly `CI` and `Real OpenCode 2.0.16 E2E` under the strict required-checks policy

#### Scenario: release candidate passes the real host gate before merging
- **WHEN** a release PR is merged into main
- **THEN** both `CI` and `Real OpenCode 2.0.16 E2E` on the PR head completed successfully under the ruleset's merge conditions

#### Scenario: governance drift fails the pipeline
- **WHEN** the ruleset's required checks no longer match the frozen baseline (for example `Real OpenCode 2.0.16 E2E` is removed again)
- **THEN** the CI drift check fails and the pipeline is red until the ruleset is restored

#### Scenario: other protections stay frozen
- **WHEN** the ruleset is modified to add the missing required check
- **THEN** enforcement, target refs, squash-only merge methods, review-thread resolution, bypass-free configuration, and deletion / non-fast-forward protection remain unchanged, proven by before/after ruleset reads