# openspec-closure-gate Specification

## Purpose
定义仓库如何证明 OpenSpec change 在 archive 后已经被 canonical specifications 吸收，并防止 active-only closure 造成 specification drift。

## Requirements

### Requirement: archived specification deltas SHALL be represented canonically
The repository SHALL verify archived OpenSpec specification deltas against canonical specs using capability, requirement, scenario and operation semantics rather than raw Markdown substring matching.

Requirement identity SHALL NOT be inferred from fuzzy title similarity. Identity SHALL be established only by an exact requirement title, a formal `RENAMED Requirements` FROM/TO operation, or an explicit version-controlled legacy compatibility mapping. The gate SHALL fail closed when no explicit identity fact exists.

#### Scenario: missing added capability is rejected
- **WHEN** an archived ADDED delta has no matching canonical capability
- **THEN** the closure gate fails and identifies the change, capability and canonical path

#### Scenario: stale modified requirement is rejected
- **WHEN** an archived MODIFIED requirement is absent or its final statement/scenarios are stale in canonical specs
- **THEN** the closure gate fails and identifies the requirement and semantic mismatch

#### Scenario: removed requirement is absent
- **WHEN** an archived REMOVED requirement no longer exists in canonical specs
- **THEN** the closure gate passes for that removal

#### Scenario: removed requirement remains
- **WHEN** an archived REMOVED requirement still exists in canonical specs
- **THEN** the closure gate fails and identifies the lingering requirement

#### Scenario: similar titles are independent
- **WHEN** two archived requirements have similar but non-identical titles and no RENAMED operation or explicit compatibility mapping exists
- **THEN** the closure gate treats them as independent requirements and MUST NOT reconcile them automatically

#### Scenario: explicit RENAMED operation establishes identity
- **WHEN** an archived `RENAMED Requirements` section contains a FROM/TO pair with valid canonical representation under the TO title
- **THEN** the closure gate passes

#### Scenario: explicit legacy compatibility alias establishes identity
- **WHEN** a version-controlled compatibility mapping exists for a historical title inconsistency and the canonical specs match the final archived semantic state
- **THEN** the closure gate passes and reports the applied alias
- **WHEN** the mapping is removed
- **THEN** the closure gate fails for that historical archive

### Requirement: malformed archived deltas SHALL fail closed
The closure gate SHALL reject archived delta files that have no recognized operation or contain incomplete ADDED, MODIFIED, REMOVED or RENAMED grammar, with an actionable diagnostic.

#### Scenario: malformed archive is checked
- **WHEN** an archived delta cannot be mapped to the supported OpenSpec grammar
- **THEN** the closure gate fails instead of silently treating the archive as complete

### Requirement: historical archive compatibility SHALL be explicit
The closure gate SHALL report the number of archived changes, capabilities, requirements, scenarios and legacy/unverifiable artifacts checked, and SHALL NOT silently skip an archive.

Historical title inconsistencies MAY be reconciled only through an explicit version-controlled compatibility mapping. Fuzzy matching, prefix/suffix heuristics, case-insensitive approximate identity, and similarity thresholds are prohibited.

#### Scenario: existing historical archives are checked
- **WHEN** the gate runs against the repository archive
- **THEN** every delta is checked or explicitly classified with a compatibility reason
