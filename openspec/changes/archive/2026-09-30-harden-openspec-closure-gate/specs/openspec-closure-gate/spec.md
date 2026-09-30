# OpenSpec closure gate

## Purpose

定义 adapter 仓库如何证明 OpenSpec archive 已将 specification delta 吸收到 canonical specs，并防止维护流程产生 specification drift。

## ADDED Requirements

### Requirement: archived specification deltas SHALL be represented canonically
The repository SHALL verify archived OpenSpec specification deltas against canonical specs using capability, requirement, scenario and operation semantics rather than raw Markdown substring matching.

#### Scenario: archived delta is missing canonically
- **WHEN** an archived ADDED capability is missing, a MODIFIED requirement is stale, or a REMOVED requirement remains
- **THEN** `test:openspec-closure` fails with the change, capability, requirement, operation and canonical path

#### Scenario: valid archive is accepted
- **WHEN** ADDED, MODIFIED and REMOVED deltas are represented by the final canonical semantic state
- **THEN** the closure gate passes

### Requirement: malformed and historical archives SHALL be explicit
The repository SHALL fail closed for malformed delta grammar and SHALL report verifiable and legacy/unverifiable archive counts instead of silently skipping archive content.

#### Scenario: malformed delta
- **WHEN** an archived spec has no recognized operation or an incomplete requirement block
- **THEN** the closure gate fails with an actionable reason

#### Scenario: historical archive
- **WHEN** the gate checks existing archive directories
- **THEN** every delta is verified or explicitly classified with a compatibility reason
