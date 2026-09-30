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

function runFixture({ delta, canonical = [], expectPass }) {
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

function runHistoryFixture({ deltas, canonical = [], expectPass }) {
  const root = mkdtempSync(path.join(tmpdir(), "openspec-closure-history-"))
  roots.push(root)
  const openspec = path.join(root, "openspec")
  const specs = path.join(openspec, "specs")
  for (const [index, delta] of deltas.entries()) {
    const archive = path.join(
      openspec,
      "changes",
      "archive",
      "2026-01-0" + (index + 1) + "-fixture",
      "specs",
      delta.capability,
    )
    mkdirSync(archive, { recursive: true })
    writeFileSync(path.join(archive, "spec.md"), delta.content)
  }
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

test("accepts the final semantic state after an earlier ADDED state", () => {
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
      content: "# malformed\\n\\n## ADDED Requirements\\n\\nThis has no requirement block.\\n",
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
