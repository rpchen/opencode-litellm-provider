import assert from "node:assert/strict"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

const roots = []
const checker = path.resolve("scripts/check-openspec-closure.mjs")

process.on("exit", () => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const addedDelta = `# Added capability

## ADDED Requirements

### Requirement: Added capability is available
The system SHALL expose the added capability.

#### Scenario: Added capability is available
- **WHEN** the capability is requested
- **THEN** the system exposes it
`

const modifiedDelta = `# Existing capability

## MODIFIED Requirements

### Requirement: Existing behavior
The system SHALL use the new behavior.

#### Scenario: New behavior is used
- **WHEN** the operation runs
- **THEN** the new behavior is returned
`

const removedDelta = `# Existing capability

## REMOVED Requirements

### Requirement: Removed behavior
`

const canonicalAdded = `# added-capability

## Purpose

A valid capability.

## Requirements

### Requirement: Added capability is available
The system SHALL expose the added capability.

#### Scenario: Added capability is available
- **WHEN** the capability is requested
- **THEN** the system exposes it
`

const canonicalOld = `# existing-capability

## Purpose

An existing capability.

## Requirements

### Requirement: Existing behavior
The system SHALL use the old behavior.

#### Scenario: Old behavior is used
- **WHEN** the operation runs
- **THEN** the old behavior is returned
`

const canonicalModified = modifiedDelta
  .replace("## MODIFIED Requirements", "## Requirements")
  .replace("# Existing capability", "# existing-capability")

const canonicalRemoved = `# existing-capability

## Purpose

An existing capability.

## Requirements

### Requirement: Removed behavior
The system SHALL still expose the removed behavior.

#### Scenario: Removed behavior remains
- **WHEN** the operation runs
- **THEN** the old behavior is returned
`

// Chronology is injected as a PARTIAL order:
//   undefined -> every fixture archive is its own layer in creation order
//   null      -> no chronology fact at all (Git history unavailable)
//   object    -> { groups: [[...], ...] } layers and/or { edges: [[a, b], ...] }
function runFixture({ delta, canonical = [], expectPass }) {
  return runArchiveFixture({
    deltas: [{ name: "2026-01-01-fixture", ...delta }],
    canonical,
    order: null,
    expectPass,
  })
}

function runArchiveFixture({ deltas, canonical = [], compat, order, expectPass }) {
  const root = mkdtempSync(path.join(tmpdir(), "openspec-closure-fixture-"))
  roots.push(root)
  const openspec = path.join(root, "openspec")
  const specs = path.join(openspec, "specs")
  const archiveNames = []
  for (const [index, delta] of deltas.entries()) {
    const name = delta.name ?? "2026-01-0" + (index + 1) + "-fixture"
    archiveNames.push(name)
    const archive = path.join(openspec, "changes", "archive", name, "specs", delta.capability)
    mkdirSync(archive, { recursive: true })
    writeFileSync(path.join(archive, "spec.md"), delta.content)
  }
  for (const item of canonical) {
    const target = path.join(specs, item.capability, "spec.md")
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, item.content)
  }

  let compatPath = path.join(openspec, "no-compat.json")
  if (compat !== undefined) {
    compatPath = path.join(openspec, "compat.json")
    writeFileSync(compatPath, JSON.stringify(compat))
  }

  const orderJson =
    order === undefined
      ? JSON.stringify({ groups: archiveNames.map((name) => [name]) })
      : order === null
        ? undefined
        : typeof order === "string"
          ? order
          : JSON.stringify(order)

  const result = spawnSync(process.execPath, [checker], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      OPENSPEC_ROOT: openspec,
      OPENSPEC_CHANGES_DIR: path.join(openspec, "changes"),
      OPENSPEC_SPECS_DIR: specs,
      OPENSPEC_CLOSURE_COMPAT: compatPath,
      OPENSPEC_CLOSURE_ORDER_JSON: orderJson,
    },
    encoding: "utf8",
  })
  assert.equal(result.error, undefined, result.error?.message)
  if (expectPass) {
    assert.equal(result.status, 0, result.stderr || result.stdout)
  } else {
    assert.notEqual(result.status, 0, "closure gate unexpectedly passed")
  }
  return result
}

const sameNameAdded = addedDelta
  .replaceAll("Added capability is available", "Existing behavior")
const sameNameModified = modifiedDelta

test("fails when an earlier ADDED state hides a stale final MODIFIED state", () => {
  const result = runArchiveFixture({
    deltas: [
      { capability: "existing-capability", content: sameNameAdded },
      { capability: "existing-capability", content: sameNameModified },
    ],
    canonical: [{ capability: "existing-capability", content: canonicalOld }],
    expectPass: false,
  })
  assert.match(result.stderr, /MODIFIED|stale/i)
})

test("exact same title across ADDED then MODIFIED passes", () => {
  runArchiveFixture({
    deltas: [
      { capability: "existing-capability", content: sameNameAdded },
      { capability: "existing-capability", content: sameNameModified },
    ],
    canonical: [{ capability: "existing-capability", content: canonicalModified }],
    expectPass: true,
  })
})

test("fails when an archived added capability is missing from canonical specs", () => {
  const result = runFixture({
    delta: { capability: "added-capability", content: addedDelta },
    expectPass: false,
  })
  assert.match(result.stderr, /2026-01-01-fixture/)
  assert.match(result.stderr, /added-capability/)
  assert.match(result.stderr, /canonical/i)
})

test("fails when an archived modified requirement is stale in canonical specs", () => {
  const result = runFixture({
    delta: { capability: "existing-capability", content: modifiedDelta },
    canonical: [{ capability: "existing-capability", content: canonicalOld }],
    expectPass: false,
  })
  assert.match(result.stderr, /Existing behavior/)
  assert.match(result.stderr, /MODIFIED|modified/)
})

test("fails when an archived removed requirement remains canonical", () => {
  const result = runFixture({
    delta: { capability: "existing-capability", content: removedDelta },
    canonical: [{ capability: "existing-capability", content: canonicalRemoved }],
    expectPass: false,
  })
  assert.match(result.stderr, /Removed behavior/)
  assert.match(result.stderr, /REMOVED|removed/)
})

test("rejects a malformed archived delta instead of silently passing", () => {
  const result = runFixture({
    delta: {
      capability: "malformed-capability",
      content: "# malformed\n\n## ADDED Requirements\n\nThis has no requirement block.\n",
    },
    expectPass: false,
  })
  assert.match(result.stderr, /malformed|requirement|delta/i)
})

test("passes when the archived delta is represented canonically", () => {
  runFixture({
    delta: { capability: "added-capability", content: addedDelta },
    canonical: [{ capability: "added-capability", content: canonicalAdded }],
    expectPass: true,
  })
})

test("passes when modified and removed deltas are represented canonically", () => {
  runFixture({
    delta: { capability: "existing-capability", content: modifiedDelta },
    canonical: [{ capability: "existing-capability", content: canonicalModified }],
    expectPass: true,
  })
  runFixture({
    delta: { capability: "existing-capability", content: removedDelta },
    canonical: [{ capability: "existing-capability", content: `# existing-capability

## Purpose

An existing capability.

## Requirements

` }],
    expectPass: true,
  })
})

// ---------------------------------------------------------------------------
// Requirement identity: explicit facts only, no fuzzy title similarity
// ---------------------------------------------------------------------------

const similarTitleAddedA = `# endpoint activation

## ADDED Requirements

### Requirement: Endpoint activation state
The system SHALL track activation state.

#### Scenario: Activation state is tracked
- **WHEN** activation state is requested
- **THEN** the current state is returned
`

const similarTitleAddedB = `# endpoint activation

## ADDED Requirements

### Requirement: Endpoint activation status
The system SHALL report activation status.

#### Scenario: Activation status is reported
- **WHEN** activation status is requested
- **THEN** the current status is returned
`

const canonicalOnlyNew = `# endpoint activation

## Purpose

Endpoint activation capability.

## Requirements

### Requirement: Endpoint activation status
The system SHALL report activation status.

#### Scenario: Activation status is reported
- **WHEN** activation status is requested
- **THEN** the current status is returned
`

test("similar requirement titles are not implicitly reconciled", () => {
  const result = runArchiveFixture({
    deltas: [
      { capability: "endpoint-activation", content: similarTitleAddedA },
      { capability: "endpoint-activation", content: similarTitleAddedB },
    ],
    canonical: [{ capability: "endpoint-activation", content: canonicalOnlyNew }],
    expectPass: false,
  })
  assert.match(result.stderr, /Endpoint activation state/)
})

const renamedFrom = `# legacy capability

## ADDED Requirements

### Requirement: Legacy requirement title
The system SHALL keep the legacy statement.

#### Scenario: Legacy behavior
- **WHEN** the legacy operation runs
- **THEN** the legacy result is returned
`

const renamedTo = `# legacy capability

## MODIFIED Requirements

### Requirement: Current requirement title
The system SHALL keep the legacy statement.

#### Scenario: Legacy behavior
- **WHEN** the legacy operation runs
- **THEN** the legacy result is returned
`

const renamedSection = `# legacy capability

## RENAMED Requirements

FROM: ### Requirement: Legacy requirement title
TO: ### Requirement: Current requirement title
`

const canonicalNewTitle = `# legacy-capability

## Purpose

A legacy capability.

## Requirements

### Requirement: Current requirement title
The system SHALL keep the legacy statement.

#### Scenario: Legacy behavior
- **WHEN** the legacy operation runs
- **THEN** the legacy result is returned
`

const canonicalOldTitle = `# legacy-capability

## Purpose

A legacy capability.

## Requirements

### Requirement: Legacy requirement title
The system SHALL keep the legacy statement.

#### Scenario: Legacy behavior
- **WHEN** the legacy operation runs
- **THEN** the legacy result is returned
`

test("explicit RENAMED operation reconciles old and new titles", () => {
  runArchiveFixture({
    deltas: [
      { capability: "legacy-capability", content: renamedFrom },
      { capability: "legacy-capability", content: renamedTo },
      { capability: "legacy-capability", content: renamedSection },
    ],
    canonical: [{ capability: "legacy-capability", content: canonicalNewTitle }],
    expectPass: true,
  })
})

test("explicit RENAMED operation fails when the new title is missing", () => {
  const result = runArchiveFixture({
    deltas: [
      { capability: "legacy-capability", content: renamedFrom },
      { capability: "legacy-capability", content: renamedSection },
    ],
    canonical: [{ capability: "legacy-capability", content: canonicalOldTitle }],
    expectPass: false,
  })
  assert.match(result.stderr, /Current requirement title|canonical requirement is missing/i)
})

const compatMapping = {
  requirementAliases: [
    {
      capability: "legacy-capability",
      from: "Legacy requirement title",
      to: "Current requirement title",
      reason: "Historical archive changed the title without an explicit RENAMED operation",
      archive: "2026-01-02-fixture",
    },
  ],
}

test("explicit legacy compatibility alias reconciles without RENAMED", () => {
  const result = runArchiveFixture({
    deltas: [
      { capability: "legacy-capability", content: renamedFrom },
      { capability: "legacy-capability", content: renamedTo },
    ],
    canonical: [{ capability: "legacy-capability", content: canonicalNewTitle }],
    compat: compatMapping,
    expectPass: true,
  })
  assert.match(result.stdout, /1 explicit legacy compatibility alias/)
})

test("removing the compatibility mapping reopens the historical mismatch", () => {
  const result = runArchiveFixture({
    deltas: [
      { capability: "legacy-capability", content: renamedFrom },
      { capability: "legacy-capability", content: renamedTo },
    ],
    canonical: [{ capability: "legacy-capability", content: canonicalNewTitle }],
    expectPass: false,
  })
  assert.match(result.stderr, /Legacy requirement title|canonical requirement is missing/i)
})

// ---------------------------------------------------------------------------
// Operation chronology: partial order from Git ancestry, never from names
// ---------------------------------------------------------------------------

const chronologyOlder = `# chronology capability

## ADDED Requirements

### Requirement: Chronological behavior
The system SHALL use the old behavior.

#### Scenario: Old behavior
- **WHEN** the operation runs
- **THEN** the old result is returned
`

const chronologyNewer = `# chronology capability

## MODIFIED Requirements

### Requirement: Chronological behavior
The system SHALL use the new behavior.

#### Scenario: New behavior
- **WHEN** the operation runs
- **THEN** the new result is returned
`

const canonicalChronologyNew = chronologyNewer
  .replace("## MODIFIED Requirements", "## Requirements")
  .replace("# chronology capability", "# chronology-capability")
const canonicalChronologyOld = chronologyOlder
  .replace("## ADDED Requirements", "## Requirements")
  .replace("# chronology capability", "# chronology-capability")

test("reversed lexical ancestry still determines the final state", () => {
  const deltas = [
    { name: "2026-01-01-z-old", capability: "chronology-capability", content: chronologyOlder },
    { name: "2026-01-01-a-new", capability: "chronology-capability", content: chronologyNewer },
  ]
  const order = { groups: [["2026-01-01-z-old"], ["2026-01-01-a-new"]] }

  const passResult = runArchiveFixture({
    deltas,
    canonical: [{ capability: "chronology-capability", content: canonicalChronologyNew }],
    order,
    expectPass: true,
  })
  assert.match(passResult.stdout, /ancestry-resolved chronology histories|injected-fixture chronology histories/)

  const failResult = runArchiveFixture({
    deltas,
    canonical: [{ capability: "chronology-capability", content: canonicalChronologyOld }],
    order,
    expectPass: false,
  })
  assert.match(failResult.stderr, /stale|ambiguous/i)
})

test("ambiguous chronology fails closed", () => {
  const deltas = [
    { name: "2026-01-01-a-first", capability: "chronology-capability", content: chronologyOlder },
    { name: "2026-01-01-b-second", capability: "chronology-capability", content: chronologyNewer },
  ]

  const result = runArchiveFixture({
    deltas,
    canonical: [{ capability: "chronology-capability", content: canonicalChronologyNew }],
    order: null,
    expectPass: false,
  })
  assert.match(result.stderr, /ambiguous archived requirement history/i)
})

test("explicit chronology resolves ambiguity", () => {
  const deltas = [
    { name: "2026-01-01-a-first", capability: "chronology-capability", content: chronologyOlder },
    { name: "2026-01-01-b-second", capability: "chronology-capability", content: chronologyNewer },
  ]
  const order = { groups: [["2026-01-01-a-first"], ["2026-01-01-b-second"]] }

  const passResult = runArchiveFixture({
    deltas,
    canonical: [{ capability: "chronology-capability", content: canonicalChronologyNew }],
    order,
    expectPass: true,
  })
  assert.equal(passResult.status, 0, passResult.stderr || passResult.stdout)

  const failResult = runArchiveFixture({
    deltas,
    canonical: [{ capability: "chronology-capability", content: canonicalChronologyOld }],
    order,
    expectPass: false,
  })
  assert.notEqual(failResult.status, 0)
})

test("invalid compatibility mapping is rejected closed", () => {
  const cases = [
    {
      requirementAliases: [
        {
          capability: "nonexistent-capability",
          from: "Legacy requirement title",
          to: "Current requirement title",
          reason: "wrong capability",
        },
      ],
    },
    {
      requirementAliases: [
        {
          capability: "legacy-capability",
          from: "Legacy requirement title",
          to: "Legacy requirement title",
          reason: "self alias",
        },
      ],
    },
    {
      requirementAliases: [
        {
          capability: "legacy-capability",
          from: "Legacy requirement title",
          to: "Current requirement title",
        },
      ],
    },
    {
      requirementAliases: [
        {
          capability: "legacy-capability",
          from: "Legacy * title",
          to: "Current requirement title",
          reason: "wildcard",
        },
      ],
    },
    {
      requirementAliases: [
        {
          capability: "legacy-capability",
          from: "Legacy requirement title",
          to: "Current requirement title",
          reason: "wrong archive",
          archive: "1999-01-01-does-not-exist",
        },
      ],
    },
  ]

  for (const invalidCompat of cases) {
    const result = runArchiveFixture({
      deltas: [
        { capability: "legacy-capability", content: renamedFrom },
        { capability: "legacy-capability", content: renamedTo },
      ],
      canonical: [{ capability: "legacy-capability", content: canonicalNewTitle }],
      expectPass: false,
      compat: invalidCompat,
    })
    assert.match(result.stderr, /compatibility alias|unknown archived requirement|not applicable|self compatibility alias|reason must be a non-empty string|capability must be a non-empty string|from must be a non-empty string|to must be a non-empty string|wildcards are not allowed|not applicable/i)
  }
})

test("invalid chronology fixture is rejected closed", () => {
  for (const order of [
    '{"groups": [["2026-01-01-a"], ["2026-01-01-a"]]}',
    '{"bogus": []}',
    '{not json',
    '{"edges": [["2026-01-01-a", "2026-01-01-b"], ["2026-01-01-b", "2026-01-01-a"]]}',
    '{"groups": "nope"}',
  ]) {
    const result = runArchiveFixture({
      deltas: [
        { name: "2026-01-01-a", capability: "chronology-capability", content: chronologyOlder },
        { name: "2026-01-01-b", capability: "chronology-capability", content: chronologyNewer },
      ],
      canonical: [{ capability: "chronology-capability", content: canonicalChronologyNew }],
      order,
      expectPass: false,
    })
    assert.match(result.stderr, /Chronology fixture is invalid/i)
  }
})

// ---------------------------------------------------------------------------
// State machine: ADDED / MODIFIED / REMOVED / RENAMED decide the terminal state
// ---------------------------------------------------------------------------

const addedRequirementX = `# history capability

## ADDED Requirements

### Requirement: Requirement X
The system SHALL expose requirement X.

#### Scenario: Requirement X is exposed
- **WHEN** requirement X is requested
- **THEN** requirement X is returned
`

const readdedRequirementX = `# history capability

## ADDED Requirements

### Requirement: Requirement X
The system SHALL expose requirement X again.

#### Scenario: Requirement X is exposed again
- **WHEN** requirement X is requested
- **THEN** requirement X is returned again
`

const modifiedRequirementX = `# history capability

## MODIFIED Requirements

### Requirement: Requirement X
The system SHALL expose requirement X in the new way.

#### Scenario: Requirement X is exposed in the new way
- **WHEN** requirement X is requested
- **THEN** requirement X is returned in the new way
`

const removedRequirementX = `# history capability

## REMOVED Requirements

### Requirement: Requirement X
`

const canonicalRequirementX = `# history-capability

## Purpose

A capability that once exposed requirement X.

## Requirements

### Requirement: Requirement X
The system SHALL expose requirement X.

#### Scenario: Requirement X is exposed
- **WHEN** requirement X is requested
- **THEN** requirement X is returned
`

const canonicalRequirementXReadded = `# history-capability

## Purpose

A capability that once exposed requirement X.

## Requirements

### Requirement: Requirement X
The system SHALL expose requirement X again.

#### Scenario: Requirement X is exposed again
- **WHEN** requirement X is requested
- **THEN** requirement X is returned again
`

const canonicalNoRequirementX = `# history-capability

## Purpose

A capability whose requirement X is gone.

## Requirements

`

test("ADDED then REMOVED ends absent and the requirement must be gone", () => {
  const deltas = [
    { capability: "history-capability", content: addedRequirementX },
    { capability: "history-capability", content: removedRequirementX },
  ]
  runArchiveFixture({
    deltas,
    canonical: [{ capability: "history-capability", content: canonicalNoRequirementX }],
    expectPass: true,
  })

  const result = runArchiveFixture({
    deltas,
    canonical: [{ capability: "history-capability", content: canonicalRequirementX }],
    expectPass: false,
  })
  assert.match(result.stderr, /REMOVED requirement remains/i)
})

test("MODIFIED then REMOVED ends absent and the requirement must be gone", () => {
  const deltas = [
    { capability: "history-capability", content: modifiedRequirementX },
    { capability: "history-capability", content: removedRequirementX },
  ]
  runArchiveFixture({
    deltas,
    canonical: [{ capability: "history-capability", content: canonicalNoRequirementX }],
    expectPass: true,
  })

  const result = runArchiveFixture({
    deltas,
    canonical: [{ capability: "history-capability", content: canonicalRequirementX }],
    expectPass: false,
  })
  assert.match(result.stderr, /REMOVED requirement remains/i)
})

test("REMOVED then re-ADDED ends present with the new semantics", () => {
  // OpenSpec 1.13.2 allows re-adding a requirement after a removal: REMOVED
  // deletes the block and a later ADDED creates it again, so the terminal state
  // is PRESENT with the re-ADDED semantics.
  const deltas = [
    { capability: "history-capability", content: removedRequirementX },
    { capability: "history-capability", content: readdedRequirementX },
  ]
  runArchiveFixture({
    deltas,
    canonical: [{ capability: "history-capability", content: canonicalRequirementXReadded }],
    expectPass: true,
  })

  const stale = runArchiveFixture({
    deltas,
    canonical: [{ capability: "history-capability", content: canonicalRequirementX }],
    expectPass: false,
  })
  assert.match(stale.stderr, /stale|missing/)

  const missing = runArchiveFixture({
    deltas,
    canonical: [{ capability: "history-capability", content: canonicalNoRequirementX }],
    expectPass: false,
  })
  assert.match(missing.stderr, /canonical requirement "Requirement X" is missing/i)
})

const renameAtoB = `# rename capability

## RENAMED Requirements

FROM: ### Requirement: Requirement A
TO: ### Requirement: Requirement B
`

const renameBtoC = `# rename capability

## RENAMED Requirements

FROM: ### Requirement: Requirement B
TO: ### Requirement: Requirement C
`

const renameAtoC = `# rename capability

## RENAMED Requirements

FROM: ### Requirement: Requirement A
TO: ### Requirement: Requirement C
`

const addedRequirementA = `# rename capability

## ADDED Requirements

### Requirement: Requirement A
The system SHALL keep the renamed statement.

#### Scenario: Renamed behavior
- **WHEN** the renamed operation runs
- **THEN** the renamed result is returned
`

const canonicalRequirement = (title) => `# rename-capability

## Purpose

A capability with one renamed requirement.

## Requirements

### Requirement: ${title}
The system SHALL keep the renamed statement.

#### Scenario: Renamed behavior
- **WHEN** the renamed operation runs
- **THEN** the renamed result is returned
`

test("RENAMED chain with proven chronology ends at the final title", () => {
  const deltas = [
    { capability: "rename-capability", content: addedRequirementA },
    { capability: "rename-capability", content: renameAtoB },
    { capability: "rename-capability", content: renameBtoC },
  ]
  runArchiveFixture({
    deltas,
    canonical: [{ capability: "rename-capability", content: canonicalRequirement("Requirement C") }],
    expectPass: true,
  })

  for (const title of ["Requirement B", "Requirement A"]) {
    const result = runArchiveFixture({
      deltas,
      canonical: [{ capability: "rename-capability", content: canonicalRequirement(title) }],
      expectPass: false,
    })
    assert.match(result.stderr, /Requirement C|historical requirement title remains/i)
  }
})

test("conflicting RENAMED operations without provable order fail ambiguous", () => {
  const result = runArchiveFixture({
    deltas: [
      { capability: "rename-capability", content: renameAtoB },
      { capability: "rename-capability", content: renameAtoC },
    ],
    canonical: [{ capability: "rename-capability", content: canonicalRequirement("Requirement B") }],
    // Explicitly incomparable: both archives descend from a shared root, so
    // neither rename can be proven first. Array/lexical order must not decide.
    order: {
      edges: [
        ["2026-01-01-root", "2026-01-01-fixture"],
        ["2026-01-01-root", "2026-01-02-fixture"],
      ],
    },
    expectPass: false,
  })
  assert.match(result.stderr, /ambiguous archived requirement history/i)
})

test("RENAMED that does not continue the recorded title fails closed", () => {
  const result = runArchiveFixture({
    deltas: [
      { capability: "rename-capability", content: renameAtoB },
      { capability: "rename-capability", content: renameAtoC },
    ],
    canonical: [{ capability: "rename-capability", content: canonicalRequirement("Requirement C") }],
    order: { groups: [["2026-01-01-fixture"], ["2026-01-02-fixture"]] },
    expectPass: false,
  })
  assert.match(result.stderr, /conflicting archived requirement history/i)
})

test("same introduction commit with equivalent final state passes", () => {
  const result = runArchiveFixture({
    deltas: [
      { name: "2026-01-01-z-old", capability: "chronology-capability", content: chronologyOlder },
      { name: "2026-01-01-a-new", capability: "chronology-capability", content: chronologyOlder },
    ],
    canonical: [{ capability: "chronology-capability", content: canonicalChronologyOld }],
    order: { groups: [["2026-01-01-z-old", "2026-01-01-a-new"]] },
    expectPass: true,
  })
  assert.match(result.stdout, /0 ancestry-resolved chronology histories/)
  assert.match(result.stdout, /0 injected-fixture chronology histories/)
})

test("same introduction commit with conflicting states fails ambiguous", () => {
  for (const canonical of [canonicalChronologyOld, canonicalChronologyNew]) {
    const result = runArchiveFixture({
      deltas: [
        { name: "2026-01-01-z-old", capability: "chronology-capability", content: chronologyOlder },
        { name: "2026-01-01-a-new", capability: "chronology-capability", content: chronologyNewer },
      ],
      canonical: [{ capability: "chronology-capability", content: canonical }],
      // Tied introduction commits. The lexical names are deliberately
      // "z-old" (older state) and "a-new" (newer state): even so, no order.
      order: { groups: [["2026-01-01-z-old", "2026-01-01-a-new"]] },
      expectPass: false,
    })
    assert.match(result.stderr, /ambiguous archived requirement history/i)
  }
})

test("incomparable introduction commits with conflicting states fail ambiguous", () => {
  for (const canonical of [canonicalChronologyOld, canonicalChronologyNew]) {
    const result = runArchiveFixture({
      deltas: [
        { name: "2026-01-01-z-old", capability: "chronology-capability", content: chronologyOlder },
        { name: "2026-01-01-a-new", capability: "chronology-capability", content: chronologyNewer },
      ],
      canonical: [{ capability: "chronology-capability", content: canonical }],
      order: {
        edges: [
          ["2026-01-01-root", "2026-01-01-z-old"],
          ["2026-01-01-root", "2026-01-01-a-new"],
        ],
      },
      expectPass: false,
    })
    assert.match(result.stderr, /ambiguous archived requirement history/i)
  }
})

test("REMOVED participates in chronology instead of being a side flag", () => {
  const deltas = [
    { name: "2026-01-01-add", capability: "history-capability", content: addedRequirementX },
    { name: "2026-01-02-remove", capability: "history-capability", content: removedRequirementX },
  ]
  const canonical = [
    { capability: "history-capability", content: canonicalNoRequirementX },
  ]

  // The removal is only terminal because it is provably later.
  const result = runArchiveFixture({
    deltas,
    canonical,
    order: { groups: [["2026-01-01-add"], ["2026-01-02-remove"]] },
    expectPass: true,
  })
  assert.match(result.stdout, /1 injected-fixture chronology histories/)

  // Reverse the proven order and the ADDED state becomes terminal instead.
  const reversed = runArchiveFixture({
    deltas,
    canonical,
    order: { groups: [["2026-01-02-remove"], ["2026-01-01-add"]] },
    expectPass: false,
  })
  assert.match(reversed.stderr, /canonical requirement "Requirement X" is missing/i)

  const ambiguous = runArchiveFixture({
    deltas,
    canonical,
    order: { groups: [["2026-01-01-add", "2026-01-02-remove"]] },
    expectPass: false,
  })
  assert.match(ambiguous.stderr, /ambiguous archived requirement history/i)
})

test("one archive replays RENAMED before REMOVED like OpenSpec applies it", () => {
  const renamedThenRemoved = `# rename capability

## RENAMED Requirements

FROM: ### Requirement: Requirement A
TO: ### Requirement: Requirement B

## REMOVED Requirements

### Requirement: Requirement B
`
  runArchiveFixture({
    deltas: [{ capability: "rename-capability", content: renamedThenRemoved }],
    canonical: [{ capability: "rename-capability", content: canonicalRequirement("Requirement B") }],
    order: null,
    expectPass: false,
  })

  const result = runArchiveFixture({
    deltas: [{ capability: "rename-capability", content: renamedThenRemoved }],
    canonical: [],
    order: null,
    expectPass: true,
  })
  assert.match(result.stdout, /0 ambiguous histories/)
})

test("one archive replays chained RENAMED pairs in file order like OpenSpec applies it", () => {
  const chainedRenames = `# rename capability

## RENAMED Requirements

FROM: ### Requirement: Requirement A
TO: ### Requirement: Requirement B

FROM: ### Requirement: Requirement B
TO: ### Requirement: Requirement C
`
  runArchiveFixture({
    deltas: [{ capability: "rename-capability", content: chainedRenames }],
    canonical: [{ capability: "rename-capability", content: canonicalRequirement("Requirement C") }],
    order: null,
    expectPass: true,
  })

  const result = runArchiveFixture({
    deltas: [{ capability: "rename-capability", content: chainedRenames }],
    canonical: [{ capability: "rename-capability", content: canonicalRequirement("Requirement B") }],
    order: null,
    expectPass: false,
  })
  assert.match(result.stderr, /Requirement C|missing/i)
})

test("conflicting state transitions inside one archive fail closed", () => {
  const conflicting = `# history capability

## ADDED Requirements

### Requirement: Requirement X
The system SHALL expose requirement X.

#### Scenario: Requirement X is exposed
- **WHEN** requirement X is requested
- **THEN** requirement X is returned

## REMOVED Requirements

### Requirement: Requirement X
`
  const result = runArchiveFixture({
    deltas: [{ capability: "history-capability", content: conflicting }],
    canonical: [{ capability: "history-capability", content: canonicalRequirementX }],
    order: null,
    expectPass: false,
  })
  assert.match(result.stderr, /malformed/i)
  assert.match(result.stderr, /multiple sections/i)
})

// ---------------------------------------------------------------------------
// Workflows that run the closure gate must check out complete Git history
// ---------------------------------------------------------------------------

function workflowJobs(text) {
  const lines = text.split(/\r?\n/)
  const jobs = []
  let inJobs = false
  let current = null
  const finish = () => {
    if (current) {
      jobs.push(current)
      current = null
    }
  }
  for (const line of lines) {
    if (/^[A-Za-z]/.test(line)) {
      finish()
      inJobs = /^jobs:\s*(#.*)?$/.test(line)
      continue
    }
    if (!inJobs) continue
    const header = line.match(/^  ([A-Za-z0-9_-]+):\s*(#.*)?$/)
    if (header) {
      finish()
      current = { name: header[1], body: "" }
      continue
    }
    if (current) current.body += line + "\n"
  }
  finish()
  return jobs
}

function checkoutSegments(jobBody) {
  const segments = []
  const pattern = /uses:\s*actions\/checkout@/g
  const nextStep = /\n[ \t]*(?:-[ \t]+)?uses:/g
  for (const match of jobBody.matchAll(pattern)) {
    nextStep.lastIndex = match.index + 1
    const boundary = nextStep.exec(jobBody)
    segments.push(jobBody.slice(match.index, boundary ? boundary.index : jobBody.length))
  }
  return segments
}

test("workflow jobs running the closure gate check out full Git history", () => {
  const workflowDir = path.resolve(".github", "workflows")
  if (!existsSync(workflowDir)) return
  const files = readdirSync(workflowDir).filter((name) => /\.ya?ml$/i.test(name))
  let gateJobs = 0
  for (const name of files) {
    const text = readFileSync(path.join(workflowDir, name), "utf8")
    for (const job of workflowJobs(text)) {
      if (!/test:openspec-closure|check-openspec-closure/.test(job.body)) continue
      gateJobs += 1
      const segments = checkoutSegments(job.body)
      assert.ok(
        segments.length > 0,
        name + " job " + job.name + " runs the closure gate but has no actions/checkout step",
      )
      for (const segment of segments) {
        assert.match(
          segment,
          /fetch-depth:\s*["']?0["']?/,
          name +
            " job " +
            job.name +
            " runs the closure gate, so its actions/checkout must set fetch-depth: 0 (chronology derives from Git ancestry)",
        )
      }
    }
  }
  assert.ok(gateJobs >= 0)
})
