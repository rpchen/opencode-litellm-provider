# OpenSpec closure gate

## Purpose

定义仓库如何证明 OpenSpec change 在 archive 后已经被 canonical specifications 吸收，并防止 active-only closure 造成 specification drift。

## ADDED Requirements

### Requirement: archived specification deltas SHALL be represented canonically
The repository SHALL verify archived OpenSpec specification deltas against canonical specs using capability, requirement, scenario and operation semantics rather than raw Markdown substring matching.

Requirement identity SHALL NOT be inferred from fuzzy title similarity. Identity SHALL be established only by an exact requirement title, a formal `RENAMED Requirements` FROM/TO operation, or an explicit version-controlled legacy compatibility mapping. The gate SHALL fail closed when no explicit identity fact exists.

Previously merged archived changes are immutable historical evidence. Later semantic evolution SHALL be represented by a later delta rather than rewriting an earlier archive.

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

### Requirement: archived requirement history SHALL be replayed as state transitions
For every requirement identity the gate SHALL derive one terminal state by replaying all archived operations as state transitions between `ABSENT` and `PRESENT(title, semantics)`. ADDED, MODIFIED, REMOVED and RENAMED SHALL all participate in that replay; REMOVED SHALL NOT be reduced to a chronology-independent flag, and the terminal state SHALL NOT be "the last operation that carries a requirement body".

RENAMED SHALL participate as an identity/title transition, so a rename chain reaches its final title only when the chain is chronologically provable. An identity that is removed and later added again SHALL end `PRESENT` with the re-ADDED semantics, because OpenSpec permits re-adding a requirement after its removal.

The gate SHALL then compare the terminal state against canonical specs: a `PRESENT` terminal state requires the canonical requirement to exist with matching statement and scenarios, and an `ABSENT` terminal state requires the canonical requirement to be gone.

Within one archived delta, operations SHALL be replayed in the order OpenSpec 1.13.2 applies them (RENAMED, then REMOVED, then MODIFIED, then ADDED, with file order inside each section). A single delta that gives one requirement name conflicting state transitions, which OpenSpec validation rejects, SHALL fail closed as malformed.

#### Scenario: added then removed ends absent
- **WHEN** an archived ADDED requirement is followed by an archived REMOVED for the same identity and the removal is chronologically later
- **THEN** the terminal state is absent and canonical specs pass only when the requirement is gone

#### Scenario: modified then removed ends absent
- **WHEN** an identity is modified and then removed under a provable chronology
- **THEN** the terminal state is absent regardless of earlier semantic states

#### Scenario: removed then re-added ends present
- **WHEN** an identity is removed and later added again under a provable chronology
- **THEN** the terminal state is present with the re-ADDED statement and scenarios

#### Scenario: renamed chain ends at the final title
- **WHEN** an identity is renamed `A -> B` and then `B -> C` under a provable chronology
- **THEN** only the title `C` is accepted in canonical specs and `A`/`B` are reported as historical titles

#### Scenario: unorderable renames fail closed
- **WHEN** two RENAMED operations cannot be ordered and do not form one consistent title chain
- **THEN** the closure gate fails as ambiguous instead of picking one by array, file or lexical order

#### Scenario: conflicting transitions inside one archive fail closed
- **WHEN** one archived delta gives one requirement name conflicting state transitions
- **THEN** the closure gate fails closed as malformed instead of guessing an order

### Requirement: archive chronology SHALL be a partial order derived from Git ancestry
Archive chronology SHALL be a partial order derived from explicit Git ancestry of the commits that introduced each archived change. It SHALL NOT be a fabricated global total order.

Archives introduced by the same commit SHALL NOT be implicitly ordered: the same introduction commit is a chronology tie, and archive name, lexical order, filesystem order, array order and timestamps MUST NOT break that tie. Two commits where neither is an ancestor of the other are incomparable and unordered. When Git history is incomplete or unavailable, no order may be derived from it.

If every provable linear extension of the partial order yields the same state for an identity, that state is the terminal state. If different states remain equally provable, the history is ambiguous and the gate SHALL fail closed.

Test fixtures MAY inject an explicit chronology, but the injected model SHALL express a partial order (ordered layers and/or explicit edges, including ties and incomparable archives) rather than forcing every archive into one total order.

#### Scenario: same introduction commit is a tie
- **WHEN** two archives that touch one identity were introduced by the same commit
- **THEN** the gate treats them as unordered and passes only when both orders give the same state

#### Scenario: same commit with conflicting states fails ambiguous
- **WHEN** two same-commit archives give one identity different final states
- **THEN** the closure gate fails with `ambiguous archived requirement history`, even when their names sort into an order

#### Scenario: incomparable histories with conflicting states fail ambiguous
- **WHEN** two archives with incomparable introduction commits give one identity different final states
- **THEN** the closure gate fails with `ambiguous archived requirement history`

#### Scenario: ambiguous archived requirement history fails closed
- **WHEN** an identity has multiple operations across different archived changes and Git ancestry proves no order between the involved archives
- **THEN** the closure gate fails and identifies the involved changes as ambiguous

#### Scenario: ancestry resolves a reversed lexical order
- **WHEN** Git ancestry proves that an archive whose name sorts later introduced an earlier state and another archive introduced the later state
- **THEN** the closure gate accepts the chronologically final state regardless of the lexical order of the archive names

### Requirement: malformed archived deltas SHALL fail closed
The closure gate SHALL reject archived delta files that have no recognized operation or contain incomplete ADDED, MODIFIED, REMOVED or RENAMED grammar, with an actionable diagnostic.

#### Scenario: malformed archive is checked
- **WHEN** an archived delta cannot be mapped to the supported OpenSpec grammar
- **THEN** the closure gate fails instead of silently treating the archive as complete

### Requirement: historical archive compatibility SHALL be explicit
The closure gate SHALL report the number of archived changes, capabilities, requirements, scenarios and legacy/unverifiable artifacts checked, and SHALL NOT silently skip an archive. It SHALL report ancestry-resolved chronology histories separately from chronology ties, and SHALL report ambiguous histories.

Historical title inconsistencies MAY be reconciled only through an explicit version-controlled compatibility mapping. Fuzzy matching, prefix/suffix heuristics, case-insensitive approximate identity, and similarity thresholds are prohibited.

#### Scenario: existing historical archives are checked
- **WHEN** the gate runs against the repository archive
- **THEN** every delta is checked or explicitly classified with a compatibility reason

#### Scenario: chronology ties are not reported as chronology resolution
- **WHEN** an identity's final state does not depend on ordering archives from one introduction commit
- **THEN** the gate reports no ancestry-resolved chronology history for that identity

### Requirement: closure workflows SHALL provide complete Git history
Any workflow job that runs Git-history-based closure validation SHALL check out the complete repository history (`fetch-depth: 0`), because archived requirement chronology is derived from Git ancestry. Jobs that do not run closure validation are not required to change.

#### Scenario: release closure verification runs with full history
- **WHEN** a release workflow runs the OpenSpec closure gate
- **THEN** its checkout provides complete Git history

#### Scenario: workflow history requirements are guarded
- **WHEN** a workflow job invokes the closure gate
- **THEN** automated regression coverage fails when that job's checkout lacks `fetch-depth: 0`
