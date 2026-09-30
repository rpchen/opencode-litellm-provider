import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
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

function runFixture({ delta, canonical = [], expectPass, extraEnv = {} }) {
  const root = mkdtempSync(path.join(tmpdir(), "openspec-closure-fixture-"))
  roots.push(root)
  const openspec = path.join(root, "openspec")
  const archive = path.join(openspec, "changes", "archive", "2026-01-01-fixture")
  const specs = path.join(openspec, "specs")
  mkdirSync(path.join(archive, "specs", delta.capability), { recursive: true })
  mkdirSync(specs, { recursive: true })
  writeFileSync(path.join(archive, "specs", delta.capability, "spec.md"), delta.content)
  for (const item of canonical) {
    const target = path.join(specs, item.capability, "spec.md")
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, item.content)
  }

  const result = spawnSync(process.execPath, [checker], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      OPENSPEC_ROOT: openspec,
      OPENSPEC_CHANGES_DIR: path.join(openspec, "changes"),
      OPENSPEC_SPECS_DIR: specs,
      OPENSPEC_CLOSURE_COMPAT: path.join(openspec, "no-compat.json"),
      ...extraEnv,
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

function runHistoryFixture({ deltas, canonical = [], expectPass, compat, order }) {
  const root = mkdtempSync(path.join(tmpdir(), "openspec-closure-history-"))
  roots.push(root)
  const openspec = path.join(root, "openspec")
  const specs = path.join(openspec, "specs")
  const archiveNames = []
  for (const [index, delta] of deltas.entries()) {
    const name = "2026-01-0" + (index + 1) + "-fixture"
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

  const result = spawnSync(process.execPath, [checker], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      OPENSPEC_ROOT: openspec,
      OPENSPEC_CHANGES_DIR: path.join(openspec, "changes"),
      OPENSPEC_SPECS_DIR: specs,
      OPENSPEC_CLOSURE_COMPAT: compatPath,
      OPENSPEC_CLOSURE_ORDER_JSON: (order ?? archiveNames).length > 0
        ? JSON.stringify(order ?? archiveNames)
        : undefined,
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
  const result = runHistoryFixture({
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
  runHistoryFixture({
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
  const result = runHistoryFixture({
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
  runHistoryFixture({
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
  const result = runHistoryFixture({
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
  const result = runHistoryFixture({
    deltas: [
      { capability: "legacy-capability", content: renamedFrom },
      { capability: "legacy-capability", content: renamedTo },
    ],
    canonical: [{ capability: "legacy-capability", content: canonicalNewTitle }],
    expectPass: true,
    compat: compatMapping,
  })
  assert.match(result.stdout, /1 explicit legacy compatibility alias/)
})

test("removing the compatibility mapping reopens the historical mismatch", () => {
  const result = runHistoryFixture({
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
// Chronology: never infer semantic order from lexicographic names
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

function runChronologyFixture({ deltas, canonical, order }) {
  const root = mkdtempSync(path.join(tmpdir(), "openspec-closure-chronology-"))
  roots.push(root)
  const openspec = path.join(root, "openspec")
  const specs = path.join(openspec, "specs")
  for (const delta of deltas) {
    const archive = path.join(openspec, "changes", "archive", delta.name, "specs", delta.capability)
    mkdirSync(archive, { recursive: true })
    writeFileSync(path.join(archive, "spec.md"), delta.content)
  }
  const target = path.join(specs, canonical.capability, "spec.md")
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, canonical.content)

  const result = spawnSync(process.execPath, [checker], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      OPENSPEC_ROOT: openspec,
      OPENSPEC_CHANGES_DIR: path.join(openspec, "changes"),
      OPENSPEC_SPECS_DIR: specs,
      OPENSPEC_CLOSURE_COMPAT: path.join(openspec, "no-compat.json"),
      OPENSPEC_CLOSURE_ORDER_JSON: order ? JSON.stringify(order) : undefined,
    },
    encoding: "utf8",
  })
  assert.equal(result.error, undefined, result.error?.message)
  return result
}

test("same-day archive lexical order MUST NOT define semantic order", () => {
  const deltas = [
    { name: "2026-01-01-z-old", capability: "chronology-capability", content: chronologyOlder },
    { name: "2026-01-01-a-new", capability: "chronology-capability", content: chronologyNewer },
  ]
  const order = ["2026-01-01-z-old", "2026-01-01-a-new"]

  const passResult = runChronologyFixture({
    deltas,
    canonical: { capability: "chronology-capability", content: canonicalChronologyNew },
    order,
  })
  assert.equal(passResult.status, 0, passResult.stderr || passResult.stdout)

  const failResult = runChronologyFixture({
    deltas,
    canonical: { capability: "chronology-capability", content: canonicalChronologyOld },
    order,
  })
  assert.notEqual(failResult.status, 0)
  assert.match(failResult.stderr, /stale|ambiguous/i)
})

test("ambiguous chronology fails closed", () => {
  const deltas = [
    { name: "2026-01-01-a-first", capability: "chronology-capability", content: chronologyOlder },
    { name: "2026-01-01-b-second", capability: "chronology-capability", content: chronologyNewer },
  ]

  const result = runChronologyFixture({
    deltas,
    canonical: { capability: "chronology-capability", content: canonicalChronologyNew },
    order: null,
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /ambiguous archived requirement history/i)
})

test("explicit chronology resolves ambiguity", () => {
  const deltas = [
    { name: "2026-01-01-a-first", capability: "chronology-capability", content: chronologyOlder },
    { name: "2026-01-01-b-second", capability: "chronology-capability", content: chronologyNewer },
  ]
  const order = ["2026-01-01-a-first", "2026-01-01-b-second"]

  const passResult = runChronologyFixture({
    deltas,
    canonical: { capability: "chronology-capability", content: canonicalChronologyNew },
    order,
  })
  assert.equal(passResult.status, 0, passResult.stderr || passResult.stdout)

  const failResult = runChronologyFixture({
    deltas,
    canonical: { capability: "chronology-capability", content: canonicalChronologyOld },
    order,
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
    const result = runHistoryFixture({
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
