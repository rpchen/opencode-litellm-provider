import { execFileSync } from "node:child_process"
import {
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs"
import path from "node:path"

const changesDir = path.resolve(process.env.OPENSPEC_CHANGES_DIR ?? "openspec/changes")
const openspecRoot = path.resolve(
  process.env.OPENSPEC_ROOT ?? path.dirname(changesDir),
)
const archiveDir = path.resolve(
  process.env.OPENSPEC_ARCHIVE_DIR ?? path.join(changesDir, "archive"),
)
const specsDir = path.resolve(
  process.env.OPENSPEC_SPECS_DIR ?? path.join(openspecRoot, "specs"),
)
const compatFile = path.resolve(
  process.env.OPENSPEC_CLOSURE_COMPAT ??
    path.join("scripts", "openspec-closure-compat.json"),
)

const requirementHeader = /^###\s+Requirement:\s*(.+?)\s*$/i
const scenarioHeader = /^####\s+(.+?)\s*$/

// OpenSpec 1.13.2 applies a delta's operations in this order (RENAMED, then
// REMOVED, then MODIFIED, then ADDED), with file order inside each section.
// See @fission-ai/openspec specs-apply.js: "Apply operations in order:
// RENAMED -> REMOVED -> MODIFIED -> ADDED". Cross-section conflicts for one
// requirement name are rejected by OpenSpec validation, so the only legitimate
// multi-operation chains inside one delta (RENAMED then REMOVED/MODIFIED of the
// new title, chained RENAMED pairs) replay deterministically under this order.
const operationRank = { RENAMED: 0, REMOVED: 1, MODIFIED: 2, ADDED: 3 }

function normalizeLineEndings(content) {
  return content.replace(/^﻿/, "").replace(/\r\n?/g, "\n")
}

function fenceMask(lines) {
  const mask = []
  let fence = null
  for (const line of lines) {
    if (fence) {
      mask.push(true)
      if (new RegExp("^\\s*" + fence + "{3,}").test(line)) fence = null
      continue
    }
    const opening = line.match(/^\s*(\x60{3,}|~{3,})/)
    mask.push(false)
    if (opening) fence = opening[1][0]
  }
  return mask
}

function topLevelSections(content) {
  const lines = normalizeLineEndings(content).split("\n")
  const mask = fenceMask(lines)
  const headers = []
  for (let index = 0; index < lines.length; index += 1) {
    if (mask[index]) continue
    const match = lines[index].match(/^##\s+(.+?)\s*$/)
    if (match) headers.push({ index, title: match[1].trim() })
  }
  return headers.map((header, position) => ({
    title: header.title,
    lines: lines.slice(
      header.index + 1,
      position + 1 < headers.length ? headers[position + 1].index : lines.length,
    ),
  }))
}

function semanticText(lines) {
  return lines
    .join("\n")
    .replace(/\r/g, "")
    .trim()
    .replace(/\s+/g, " ")
}

function scenarioName(title) {
  return title
    .replace(/^Scenario:\s*/i, "")
    .replace(/[ \t]+#+[ \t]*$/, "")
    .trim()
}

function parseRequirementBlock(lines, name) {
  const mask = fenceMask(lines)
  const scenarios = []
  let scenarioStart = -1

  for (let index = 0; index < lines.length; index += 1) {
    if (mask[index]) continue
    const match = lines[index].match(scenarioHeader)
    if (!match) continue
    if (scenarioStart === -1) {
      scenarioStart = index
    } else {
      scenarios.push({
        name: scenarioName(lines[scenarioStart].replace(/^####\s+/, "")),
        body: semanticText(lines.slice(scenarioStart + 1, index)),
      })
      scenarioStart = index
    }
  }
  if (scenarioStart !== -1) {
    scenarios.push({
      name: scenarioName(lines[scenarioStart].replace(/^####\s+/, "")),
      body: semanticText(lines.slice(scenarioStart + 1)),
    })
  }

  const statementEnd = scenarioStart === -1 ? lines.length : scenarioStart
  const statement = semanticText(lines.slice(0, statementEnd))
  return {
    name: name.trim(),
    statement,
    scenarios: scenarios.sort((left, right) =>
      (left.name + "\0" + left.body).localeCompare(right.name + "\0" + right.body),
    ),
  }
}

function parseRequirementBlocks(lines, source) {
  const mask = fenceMask(lines)
  const blocks = []
  const skippedHeaders = []
  let current = null

  const finish = () => {
    if (!current) return
    blocks.push(parseRequirementBlock(current.body, current.name))
    current = null
  }

  for (let index = 0; index < lines.length; index += 1) {
    if (!mask[index] && requirementHeader.test(lines[index])) {
      finish()
      const name = lines[index].match(requirementHeader)[1].trim()
      current = { name, body: [] }
      continue
    }
    if (!mask[index] && /^###\s+/.test(lines[index]) && !current) {
      skippedHeaders.push(lines[index].trim())
    }
    if (current) current.body.push(lines[index])
  }
  finish()

  if (skippedHeaders.length > 0) {
    throw new Error(
      source +
        ": unrecognized requirement header(s): " +
        skippedHeaders.join(", "),
    )
  }
  return blocks
}

function parseCanonicalSpec(content, source) {
  const requirementsSection = topLevelSections(content).find(
    (section) => section.title.toLowerCase() === "requirements",
  )
  if (!requirementsSection) {
    throw new Error(source + ": missing ## Requirements section")
  }
  const blocks = parseRequirementBlocks(requirementsSection.lines, source)
  const requirements = new Map()
  for (const requirement of blocks) {
    if (requirements.has(requirement.name)) {
      throw new Error(source + ': duplicate requirement "' + requirement.name + '"')
    }
    requirements.set(requirement.name, requirement)
  }
  return requirements
}

function parseDeltaSpec(content, source) {
  const sections = topLevelSections(content)
  const operations = []
  let operationSectionCount = 0

  for (const section of sections) {
    const operationMatch = section.title.match(
      /^(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements$/i,
    )
    if (!operationMatch) continue
    const operation = operationMatch[1].toUpperCase()
    operationSectionCount += 1

    if (operation === "RENAMED") {
      const lines = normalizeLineEndings(section.lines.join("\n")).split("\n")
      let from
      let pairCount = 0
      for (const line of lines) {
        const fromMatch = line.match(
          /^\s*[-*+]?\s*FROM:\s*(?:\x60)?###\s*Requirement:\s*(.+?)(?:\x60)?\s*$/i,
        )
        const toMatch = line.match(
          /^\s*[-*+]?\s*TO:\s*(?:\x60)?###\s*Requirement:\s*(.+?)(?:\x60)?\s*$/i,
        )
        if (fromMatch) {
          from = fromMatch[1].trim()
        } else if (toMatch && from) {
          operations.push({
            operation,
            from,
            to: toMatch[1].trim(),
          })
          from = undefined
          pairCount += 1
        }
      }
      if (pairCount === 0) {
        throw new Error(source + ": RENAMED Requirements has no FROM/TO pair")
      }
      continue
    }

    if (operation === "REMOVED") {
      const lines = normalizeLineEndings(section.lines.join("\n")).split("\n")
      const mask = fenceMask(lines)
      const names = []
      for (let index = 0; index < lines.length; index += 1) {
        if (mask[index]) continue
        const header = lines[index].match(requirementHeader)
        const bullet = lines[index].match(
          /^\s*[-*+]?\s*(?:\x60)?###\s*Requirement:\s*(.+?)(?:\x60)?\s*$/i,
        )
        if (header) names.push(header[1].trim())
        else if (bullet) names.push(bullet[1].trim())
      }
      if (names.length === 0) {
        throw new Error(source + ": REMOVED Requirements has no requirement")
      }
      for (const name of names) operations.push({ operation, name })
      continue
    }

    const blocks = parseRequirementBlocks(section.lines, source)
    if (blocks.length === 0) {
      throw new Error(source + ": " + operation + " Requirements has no requirement")
    }
    for (const requirement of blocks) {
      if (!requirement.statement || requirement.scenarios.length === 0) {
        throw new Error(
          source +
            ': ' +
            operation +
            ' requirement "' +
            requirement.name +
            '" must contain a statement and at least one scenario',
        )
      }
      operations.push({ operation, requirement })
    }
  }

  if (operationSectionCount === 0) {
    throw new Error(source + ": no ADDED/MODIFIED/REMOVED/RENAMED Requirements section")
  }
  return operations
}

// OpenSpec 1.13.2 rejects a delta that gives one requirement name conflicting
// state transitions (`openspec validate`: "Requirement present in both ...").
// The gate mirrors those grammar rules so a hand-written archive cannot smuggle
// an ambiguous transition past the closure check.
function validateDeltaOperations(operations, source) {
  const added = []
  const modified = []
  const removed = []
  const renamed = []

  for (const operation of operations) {
    if (operation.operation === "RENAMED") renamed.push(operation)
    else if (operation.operation === "REMOVED") removed.push(operation.name)
    else if (operation.operation === "MODIFIED") modified.push(operation.requirement.name)
    else added.push(operation.requirement.name)
  }

  const duplicate = (names, section) => {
    const seen = new Set()
    for (const name of names) {
      if (seen.has(name)) {
        throw new Error(
          source + ": duplicate requirement in " + section + ' for "### Requirement: ' + name + '"',
        )
      }
      seen.add(name)
    }
  }
  duplicate(added, "ADDED")
  duplicate(modified, "MODIFIED")
  duplicate(removed, "REMOVED")

  const renamedFrom = []
  const renamedTo = []
  for (const pair of renamed) {
    if (renamedFrom.includes(pair.from)) {
      throw new Error(source + ': duplicate FROM in RENAMED for "### Requirement: ' + pair.from + '"')
    }
    if (renamedTo.includes(pair.to)) {
      throw new Error(source + ': duplicate TO in RENAMED for "### Requirement: ' + pair.to + '"')
    }
    renamedFrom.push(pair.from)
    renamedTo.push(pair.to)
  }

  const conflictingSections = (name, first, second) => {
    throw new Error(
      source +
        ": requirement present in multiple sections (" +
        first +
        " and " +
        second +
        ') for "### Requirement: ' +
        name +
        '"; a single delta must not give one requirement conflicting state transitions',
    )
  }
  for (const name of modified) {
    if (removed.includes(name)) conflictingSections(name, "MODIFIED", "REMOVED")
    if (added.includes(name)) conflictingSections(name, "MODIFIED", "ADDED")
  }
  for (const name of added) {
    if (removed.includes(name)) conflictingSections(name, "ADDED", "REMOVED")
  }
  for (const pair of renamed) {
    if (modified.includes(pair.from)) {
      conflictingSections(pair.from, "RENAMED", "MODIFIED")
    }
    if (added.includes(pair.to)) {
      conflictingSections(pair.to, "RENAMED", "ADDED")
    }
    if (removed.includes(pair.from)) {
      conflictingSections(pair.from, "RENAMED", "REMOVED")
    }
  }
}

function collectSpecFiles(root) {
  const files = []
  if (!existsSync(root)) return files

  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(file)
      else if (entry.isFile() && entry.name === "spec.md") files.push(file)
    }
  }
  visit(root)
  return files.sort()
}

function capabilityId(specRoot, specFile) {
  const relative = path.relative(specRoot, path.dirname(specFile))
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      specFile + ": spec.md must be inside a capability directory under openspec/specs",
    )
  }
  return relative.split(path.sep).join("/")
}

function canonicalPath(capability) {
  return path.join(specsDir, ...capability.split("/"), "spec.md")
}

function hasSkipSpecsMarker(changeDir) {
  const metadata = path.join(changeDir, ".openspec.yaml")
  if (!existsSync(metadata)) return false
  return /^\s*skip_specs\s*:\s*true\s*$/im.test(readFileSync(metadata, "utf8"))
}

function sameRequirement(left, right, { ignoreName = false } = {}) {
  if (!left || !right) return false
  if (!ignoreName && left.name !== right.name) return false
  if (left.statement !== right.statement) return false
  if (left.scenarios.length !== right.scenarios.length) return false
  return left.scenarios.every(
    (scenario, index) =>
      scenario.name === right.scenarios[index].name &&
      scenario.body === right.scenarios[index].body,
  )
}

function loadCompatibilityData(file) {
  if (!existsSync(file)) return { requirementAliases: [] }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"))
  } catch (error) {
    throw new Error(
      file +
        ": invalid JSON: " +
        (error instanceof Error ? error.message : String(error)),
    )
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(file + ": must be an object")
  }
  const requirementAliases = Array.isArray(parsed.requirementAliases)
    ? parsed.requirementAliases.map((alias, index) => {
        const where = file + " requirementAliases[" + index + "]"
        if (alias === null || typeof alias !== "object" || Array.isArray(alias)) {
          throw new Error(where + ": alias must be an object")
        }
        const { capability, from, to, reason, archive } = alias
        for (const [field, value] of Object.entries({ capability, from, to, reason })) {
          if (typeof value !== "string" || value.trim() === "") {
            throw new Error(where + ": " + field + " must be a non-empty string")
          }
        }
        if (archive !== undefined && (typeof archive !== "string" || archive.trim() === "")) {
          throw new Error(where + ": archive must be a non-empty string when present")
        }
        if (from === to) {
          throw new Error(where + ": self compatibility alias is not allowed (from and to must differ)")
        }
        if ([capability, from, to].some((value) => /[*?]/.test(value))) {
          throw new Error(where + ": capability/from/to must be explicit (wildcards are not allowed)")
        }
        return { capability, from, to, reason, archive: archive ?? null }
      })
    : []
  return { requirementAliases }
}

// ---------------------------------------------------------------------------
// Archive chronology is a PARTIAL order derived from Git ancestry
// ---------------------------------------------------------------------------

function gitIsAncestor(left, right) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", left, right], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

// First commit that introduced a file under the archived change. A missing or
// unusable Git history yields null and is NEVER interpreted as an order: it
// cannot make an archive older or newer than another one.
function gitIntroductionCommit(archiveName) {
  const pathspec = path.posix.join("openspec/changes/archive", archiveName, "**/spec.md")
  let output
  try {
    output = execFileSync("git", ["log", "--diff-filter=A", "--format=%H", "--", pathspec], {
      encoding: "utf8",
    })
  } catch {
    return null
  }
  return (
    output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1) ?? null
  )
}

// Fixture injection for unit tests. The model is a partial order, never a
// forced total order:
//   { "groups": [["a"], ["b", "c"]] }  -> a before both; b and c are tied
//   { "edges": [["a", "b"]] }          -> a before b; unrelated names stay
//                                         incomparable instead of being sorted
function parseChronologyFixture(raw) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(
      "OPENSPEC_CLOSURE_ORDER_JSON: invalid JSON: " +
        (error instanceof Error ? error.message : String(error)),
    )
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "OPENSPEC_CLOSURE_ORDER_JSON: must be an object with optional groups/edges expressing a partial order",
    )
  }
  for (const key of Object.keys(parsed)) {
    if (key !== "groups" && key !== "edges") {
      throw new Error("OPENSPEC_CLOSURE_ORDER_JSON: unknown key " + JSON.stringify(key))
    }
  }

  const layerOf = new Map()
  const nodes = new Set()
  const edges = []
  const groups = parsed.groups ?? []
  if (!Array.isArray(groups)) {
    throw new Error("OPENSPEC_CLOSURE_ORDER_JSON: groups must be an array of layers")
  }
  groups.forEach((layer, index) => {
    if (!Array.isArray(layer)) {
      throw new Error("OPENSPEC_CLOSURE_ORDER_JSON: groups[" + index + "] must be an array of archive names")
    }
    for (const name of layer) {
      if (typeof name !== "string" || name.trim() === "") {
        throw new Error(
          "OPENSPEC_CLOSURE_ORDER_JSON: groups[" + index + "] must contain non-empty archive names",
        )
      }
      if (layerOf.has(name)) {
        throw new Error(
          "OPENSPEC_CLOSURE_ORDER_JSON: archive " + JSON.stringify(name) + " appears in more than one layer",
        )
      }
      layerOf.set(name, index)
      nodes.add(name)
    }
  })

  const rawEdges = parsed.edges ?? []
  if (!Array.isArray(rawEdges)) {
    throw new Error("OPENSPEC_CLOSURE_ORDER_JSON: edges must be an array of [before, after] pairs")
  }
  rawEdges.forEach((edge, index) => {
    if (!Array.isArray(edge) || edge.length !== 2) {
      throw new Error("OPENSPEC_CLOSURE_ORDER_JSON: edges[" + index + "] must be a [before, after] pair")
    }
    const [from, to] = edge
    if (
      typeof from !== "string" ||
      typeof to !== "string" ||
      from.trim() === "" ||
      to.trim() === ""
    ) {
      throw new Error(
        "OPENSPEC_CLOSURE_ORDER_JSON: edges[" + index + "] must contain non-empty archive names",
      )
    }
    if (from === to) {
      throw new Error("OPENSPEC_CLOSURE_ORDER_JSON: edges[" + index + "] must not order an archive against itself")
    }
    nodes.add(from)
    nodes.add(to)
    edges.push([from, to])
  })

  if (nodes.size === 0) {
    throw new Error("OPENSPEC_CLOSURE_ORDER_JSON: expresses no archives")
  }

  // Later layers are after earlier layers; explicit edges add to that.
  const reach = new Map([...nodes].map((name) => [name, new Set()]))
  for (const [from, to] of edges) reach.get(from).add(to)
  const names = [...nodes]
  for (const earlier of names) {
    for (const later of names) {
      if (layerOf.has(earlier) && layerOf.has(later) && layerOf.get(earlier) < layerOf.get(later)) {
        reach.get(earlier).add(later)
      }
    }
  }
  for (const middle of names) {
    for (const from of names) {
      if (!reach.get(from).has(middle)) continue
      for (const to of reach.get(middle)) reach.get(from).add(to)
    }
  }
  for (const name of names) {
    if (reach.get(name).has(name)) {
      throw new Error("OPENSPEC_CLOSURE_ORDER_JSON: chronology edges contain a cycle")
    }
  }

  const relation = (left, right) => {
    if (left === right) return "same"
    if (!nodes.has(left) || !nodes.has(right)) return "unknown"
    if (reach.get(left).has(right)) return "before"
    if (reach.get(right).has(left)) return "after"
    if (layerOf.has(left) && layerOf.get(left) === layerOf.get(right)) return "same"
    return "incomparable"
  }
  return { relation }
}

function resolveArchiveChronology(archiveNames) {
  const commitByArchive = new Map()
  for (const name of archiveNames) {
    const commit = gitIntroductionCommit(name)
    if (commit) commitByArchive.set(name, commit)
  }

  // Chronology fixture: env (test injection) first, then the committed repo
  // fixture (`openspec/openspec-chronology.json`). A committed fixture exists
  // for squashed archives whose git introduction commits collapse into one
  // SHA (ancestry cannot order them); it is reviewed like code.
  const fixtureRaw = process.env.OPENSPEC_CLOSURE_ORDER_JSON ??
    (existsSync(path.join(openspecRoot, "openspec-chronology.json"))
      ? readFileSync(path.join(openspecRoot, "openspec-chronology.json"), "utf8")
      : undefined)
  const fixture = fixtureRaw ? parseChronologyFixture(fixtureRaw) : null

  const relation = (left, right) => {
    if (fixture) return fixture.relation(left, right)
    const leftCommit = commitByArchive.get(left)
    const rightCommit = commitByArchive.get(right)
    if (!leftCommit || !rightCommit) return "unknown"
    if (leftCommit === rightCommit) return "same"
    if (gitIsAncestor(leftCommit, rightCommit)) return "before"
    if (gitIsAncestor(rightCommit, leftCommit)) return "after"
    return "incomparable"
  }

  return {
    relation,
    source: fixture ? "fixture" : "git",
    commitByArchive,
  }
}

function buildOperationGroups(records, aliases) {
  const byCapability = new Map()
  for (const record of records) {
    let capability = byCapability.get(record.capability)
    if (!capability) {
      capability = []
      byCapability.set(record.capability, capability)
    }
    capability.push(record)
  }

  const groups = new Map()
  let compatibilityAliases = 0

  for (const [capability, capabilityRecords] of byCapability) {
    const names = [
      ...new Set(
        capabilityRecords.flatMap((record) =>
          record.operation === "RENAMED" ? [record.from, record.to] : [record.name],
        ),
      ),
    ]
    const parent = new Map(names.map((name) => [name, name]))
    const find = (name) => {
      let current = name
      while (parent.get(current) !== current) {
        current = parent.get(current)
      }
      return current
    }
    const union = (left, right) => {
      const leftRoot = find(left)
      const rightRoot = find(right)
      if (leftRoot !== rightRoot) parent.set(leftRoot, rightRoot)
    }

    // Formal OpenSpec RENAMED operations are first-class identity facts.
    const renamedEdges = []
    for (const record of capabilityRecords) {
      if (record.operation === "RENAMED" && record.from && record.to) {
        renamedEdges.push([record.from, record.to])
      }
    }
    for (const [from, to] of renamedEdges) {
      if (!parent.has(from) || !parent.has(to)) {
        throw new Error(
          "RENAMED operation references unknown archived requirement: " +
            capability +
            ' "' +
            from +
            '" -> "' +
            to +
            '"',
        )
      }
      union(from, to)
    }

    // Explicit legacy compatibility aliases are the only other identity edge.
    const capabilityAliases = aliases.filter(
      (alias) => alias.capability === capability,
    )
    for (const alias of capabilityAliases) {
      const fromRecord = capabilityRecords.find(
        (record) =>
          record.name === alias.from &&
          (record.operation === "ADDED" || record.operation === "MODIFIED"),
      )
      const toRecord = capabilityRecords.find(
        (record) =>
          record.name === alias.to &&
          (record.operation === "ADDED" || record.operation === "MODIFIED"),
      )
      if (!fromRecord || !toRecord) {
        throw new Error(
          "compatibility alias references unknown archived requirement: " +
            capability +
            ' "' +
            (!fromRecord ? alias.from : alias.to) +
            '"',
        )
      }
      if (alias.archive) {
        const fromMatches = fromRecord.change === alias.archive
        const toMatches = toRecord.change === alias.archive
        if (!fromMatches && !toMatches) {
          throw new Error(
            "compatibility alias is not applicable to archived operations for capability " +
              capability +
              ' from "' +
              alias.from +
              '" to "' +
              alias.to +
              '" in archive ' +
              alias.archive,
          )
        }
      }
      union(alias.from, alias.to)
      compatibilityAliases += 1
    }

    const grouped = new Map()
    for (const record of capabilityRecords) {
      const root = find(record.name)
      let group = grouped.get(root)
      if (!group) {
        group = { names: new Set(), records: [] }
        grouped.set(root, group)
      }
      group.names.add(record.name)
      if (record.operation === "RENAMED") group.names.add(record.to)
      group.records.push(record)
    }
    groups.set(capability, grouped)
  }

  // Any alias whose capability was never seen in the archive fails closed.
  const knownCapabilities = new Set(byCapability.keys())
  for (const alias of aliases) {
    if (!knownCapabilities.has(alias.capability)) {
      throw new Error(
        "compatibility alias references unknown archived capability: " +
          alias.capability,
      )
    }
  }

  return { groups, compatibilityAliases }
}

// ---------------------------------------------------------------------------
// Requirement history is a state machine replayed under the partial order
// ---------------------------------------------------------------------------

function semanticsKey(requirement) {
  if (!requirement) return ""
  return (
    requirement.statement +
    "\u0000" +
    requirement.scenarios
      .map((scenario) => scenario.name + "\u0001" + scenario.body)
      .join("\u0002")
  )
}

// ABSENT -> ADDED -> PRESENT(title, semantics) -> MODIFIED -> PRESENT(...)
// PRESENT -> RENAMED -> PRESENT(new title, same semantics)
// PRESENT -> REMOVED -> ABSENT -> ADDED -> PRESENT again
// A state whose history is not known yet is `unknown`, never `absent`: an
// archived MODIFIED only proves the requirement existed before it.
function initialState() {
  return { kind: "unknown" }
}

function conflictState(event, reason) {
  return {
    kind: "conflict",
    reason:
      reason +
      ' (change ' +
      event.change +
      ": " +
      event.operation +
      " " +
      (event.operation === "RENAMED"
        ? '"' + event.from + '" -> "' + event.to + '"'
        : '"' + event.name + '"') +
      ")",
  }
}

function applyOperation(state, event) {
  if (state.kind === "conflict") return state
  switch (event.operation) {
    case "ADDED":
      return { kind: "present", title: event.name, semantics: event.requirement }
    case "MODIFIED":
      if (state.kind === "absent") {
        return conflictState(
          event,
          "MODIFIED applies to requirement \"" + event.name + '" which is absent in the recorded history',
        )
      }
      return { kind: "present", title: event.name, semantics: event.requirement }
    case "REMOVED":
      if (state.kind === "absent") return state
      return { kind: "absent", title: event.name }
    case "RENAMED": {
      if (state.kind === "absent") {
        return conflictState(
          event,
          "RENAMED applies to requirement \"" + event.from + '" which is absent in the recorded history',
        )
      }
      if (state.kind === "unknown") {
        return { kind: "present", title: event.to, semantics: null }
      }
      if (state.title === event.from) {
        return { kind: "present", title: event.to, semantics: state.semantics }
      }
      if (state.title === event.to) return state
      return conflictState(
        event,
        "conflicting RENAMED operations: \"" +
          event.from +
          '" -> "' +
          event.to +
          '" does not continue the recorded title "' +
          state.title +
          '"',
      )
    }
    default:
      return conflictState(event, "unknown operation " + event.operation)
  }
}

function stateKey(state) {
  if (state.kind === "conflict") return "conflict\u0000" + state.reason
  if (state.kind === "absent") return "absent"
  if (state.kind === "unknown") return "unknown"
  return "present\u0000" + state.title + "\u0000" + semanticsKey(state.semantics)
}

function describeState(state) {
  if (state.kind === "conflict") return "conflict (" + state.reason + ")"
  if (state.kind === "absent") return "absent"
  if (state.kind === "unknown") return "unknown"
  return 'present "' + state.title + '"' + (state.semantics ? "" : " (title only)")
}

// Every linear extension of the proven partial order must reach the same final
// state; otherwise the history is ambiguous and the gate fails closed. The
// replay never breaks a tie by archive name, lexical order, or array order.
function replayOutcomes(events, isBefore) {
  const total = events.length
  const fullMask = (1 << total) - 1
  const memo = new Map()

  const outcomes = (mask) => {
    if (mask === 0) {
      return new Map([[stateKey(initialState()), initialState()]])
    }
    if (memo.has(mask)) return memo.get(mask)
    const result = new Map()
    for (let index = 0; index < total; index += 1) {
      const bit = 1 << index
      if ((mask & bit) === 0) continue
      const prior = mask ^ bit
      let ready = true
      for (let other = 0; other < total; other += 1) {
        if (isBefore(other, index) && (prior & (1 << other)) === 0) {
          ready = false
          break
        }
      }
      if (!ready) continue
      for (const state of outcomes(prior).values()) {
        const next = applyOperation(state, events[index])
        result.set(stateKey(next), next)
      }
    }
    memo.set(mask, result)
    return result
  }

  return [...outcomes(fullMask).values()]
}

const maxReplayEvents = 20

function formatFailure({ change, capability, operation, requirement, reason }) {
  const requirementLine = requirement ? "\nrequirement: " + requirement : ""
  return (
    "Archived OpenSpec change is not reflected in canonical specs:\n" +
    "change: " +
    change +
    "\ncapability: " +
    capability +
    "\noperation: " +
    operation +
    requirementLine +
    "\nexpected canonical:\n  openspec/specs/" +
    capability +
    "/spec.md\nreason:\n  " +
    reason
  )
}

function formatMalformed({ change, capability, reason }) {
  return (
    "Archived OpenSpec delta is malformed:\n" +
    "change: " +
    change +
    "\ncapability: " +
    capability +
    "\nexpected canonical:\n  openspec/specs/" +
    capability +
    "/spec.md\nreason:\n  " +
    reason
  )
}

function main() {
  const failures = []
  const archivedOperations = []
  const archiveEntries = existsSync(archiveDir)
    ? readdirSync(archiveDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .sort((left, right) => left.name.localeCompare(right.name))
    : []
  const archiveNames = archiveEntries.map((entry) => entry.name)
  const legacyArtifacts = []
  let capabilitiesChecked = 0
  let requirementsChecked = 0
  let scenariosChecked = 0

  if (existsSync(changesDir)) {
    for (const entry of readdirSync(changesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "archive") continue
      const tasksPath = path.join(changesDir, entry.name, "tasks.md")
      if (!existsSync(tasksPath)) continue
      const text = readFileSync(tasksPath, "utf8")
      const checked = [...text.matchAll(/^- \[x\]/gim)].length
      const unchecked = [...text.matchAll(/^- \[ \]/gm)].length
      if (checked > 0 && unchecked === 0) {
        failures.push(
          "Completed OpenSpec changes must be archived before merge:\n- " +
            entry.name,
        )
      }
    }
  }

  for (const archiveEntry of archiveEntries) {
    const changeDir = path.join(archiveDir, archiveEntry.name)
    for (const rootSpec of collectSpecFiles(changeDir)) {
      const relative = path.relative(changeDir, rootSpec).split(path.sep).join("/")
      if (!relative.startsWith("specs/")) {
        legacyArtifacts.push(archiveEntry.name + "/" + relative)
      }
    }

    const changeSpecsDir = path.join(changeDir, "specs")
    const deltaFiles = collectSpecFiles(changeSpecsDir)
    const skipSpecs = hasSkipSpecsMarker(changeDir)
    if (deltaFiles.length === 0) {
      if (!skipSpecs) {
        failures.push(
          formatMalformed({
            change: archiveEntry.name,
            capability: "(none)",
            reason:
              "archive contains no delta spec under specs/ and has no skip_specs: true metadata",
          }),
        )
      }
      continue
    }
    if (skipSpecs) {
      failures.push(
        "Archived OpenSpec change is malformed:\nchange: " +
          archiveEntry.name +
          "\nreason:\n  .openspec.yaml declares skip_specs: true but specs/ contains delta files",
      )
      continue
    }

    for (const deltaFile of deltaFiles) {
      let capability
      try {
        capability = capabilityId(changeSpecsDir, deltaFile)
        const operations = parseDeltaSpec(
          readFileSync(deltaFile, "utf8"),
          archiveEntry.name + "/" + path.relative(changeDir, deltaFile),
        )
        validateDeltaOperations(
          operations,
          archiveEntry.name + "/" + path.relative(changeDir, deltaFile),
        )
        capabilitiesChecked += 1
        requirementsChecked += operations.length
        scenariosChecked += operations.reduce(
          (total, operation) => total + (operation.requirement?.scenarios.length ?? 0),
          0,
        )
        const sectionCounters = { RENAMED: 0, REMOVED: 0, MODIFIED: 0, ADDED: 0 }
        for (const operation of operations) {
          const applyRank =
            operationRank[operation.operation] * 1000 +
            sectionCounters[operation.operation]
          sectionCounters[operation.operation] += 1
          if (operation.operation === "RENAMED") {
            archivedOperations.push({
              capability,
              change: archiveEntry.name,
              operation: "RENAMED",
              name: operation.from,
              from: operation.from,
              to: operation.to,
              applyRank,
            })
          } else if (operation.operation === "REMOVED") {
            archivedOperations.push({
              capability,
              change: archiveEntry.name,
              operation: "REMOVED",
              name: operation.name,
              applyRank,
            })
          } else {
            archivedOperations.push({
              capability,
              change: archiveEntry.name,
              operation: operation.operation,
              name: operation.requirement.name,
              requirement: operation.requirement,
              applyRank,
            })
          }
        }
      } catch (error) {
        failures.push(
          formatMalformed({
            change: archiveEntry.name,
            capability: capability ?? "(unresolved)",
            reason: error instanceof Error ? error.message : String(error),
          }),
        )
      }
    }
  }

  const canonicalCache = new Map()
  const readCanonical = (capability) => {
    if (canonicalCache.has(capability)) return canonicalCache.get(capability)
    const file = canonicalPath(capability)
    if (!existsSync(file)) {
      const result = { exists: false, requirements: new Map() }
      canonicalCache.set(capability, result)
      return result
    }
    try {
      const result = {
        exists: true,
        requirements: parseCanonicalSpec(
          readFileSync(file, "utf8"),
          "openspec/specs/" + capability + "/spec.md",
        ),
      }
      canonicalCache.set(capability, result)
      return result
    } catch (error) {
      failures.push(
        formatFailure({
          change: "(canonical)",
          capability,
          operation: "CANONICAL",
          reason: error instanceof Error ? error.message : String(error),
        }),
      )
      const result = { exists: true, requirements: new Map() }
      canonicalCache.set(capability, result)
      return result
    }
  }

  let compatibilityAliases = 0
  let ancestryResolved = 0
  let fixtureResolved = 0
  let ambiguousHistories = 0

  let compat = { requirementAliases: [] }
  try {
    compat = loadCompatibilityData(compatFile)
  } catch (error) {
    failures.push(
      "Compatibility mapping is invalid:\n" +
        (error instanceof Error ? error.message : String(error)),
    )
  }

  let chronology = null
  try {
    chronology = resolveArchiveChronology(archiveNames)
  } catch (error) {
    failures.push(
      "Chronology fixture is invalid:\n" +
        (error instanceof Error ? error.message : String(error)),
    )
  }

  if (chronology) {
    try {
      const operationGroups = buildOperationGroups(
        archivedOperations,
        compat.requirementAliases,
      )
      compatibilityAliases = operationGroups.compatibilityAliases

      for (const [capability, groups] of operationGroups.groups) {
        const canonical = readCanonical(capability)
        for (const group of groups.values()) {
          const events = [...group.records].sort(
            (left, right) =>
              left.change.localeCompare(right.change) || left.applyRank - right.applyRank,
          )
          const involvedChanges = [...new Set(events.map((event) => event.change))]

          if (events.length > maxReplayEvents) {
            failures.push(
              formatFailure({
                change: involvedChanges.join(", "),
                capability,
                operation: "AMBIGUOUS",
                requirement: events[0].name,
                reason:
                  "ambiguous archived requirement history: " +
                  events.length +
                  " archived operations for one identity exceed the replay limit; prove their order explicitly",
              }),
            )
            ambiguousHistories += 1
            continue
          }

          const strictBefore = events.map(() => events.map(() => false))
          const looseBefore = events.map(() => events.map(() => false))
          for (let left = 0; left < events.length; left += 1) {
            for (let right = 0; right < events.length; right += 1) {
              if (left === right) continue
              const earlier = events[left]
              const later = events[right]
              if (earlier.change === later.change) {
                strictBefore[left][right] = earlier.applyRank < later.applyRank
                looseBefore[left][right] = earlier.applyRank < later.applyRank
              } else if (chronology.relation(earlier.change, later.change) === "before") {
                strictBefore[left][right] = true
              }
            }
          }

          // The same introduction commit, incomparable commits and unavailable
          // Git history all leave events unordered: a tie is never an order.
          const outcomes = replayOutcomes(events, (l, r) => strictBefore[l][r])
          const outcomesWithoutChronology = replayOutcomes(events, (l, r) =>
            looseBefore[l][r],
          )

          if (outcomes.length > 1) {
            failures.push(
              formatFailure({
                change: involvedChanges.join(", "),
                capability,
                operation: "AMBIGUOUS",
                requirement: events[0].name,
                reason:
                  "ambiguous archived requirement history: " +
                  outcomes.length +
                  " final states are equally provable for this identity and Git ancestry proves no order between the involved archives (" +
                  involvedChanges.join(", ") +
                  "); candidate states: " +
                  outcomes.map(describeState).join(" | "),
              }),
            )
            ambiguousHistories += 1
            continue
          }

          const terminal = outcomes[0]
          if (terminal.kind === "conflict") {
            failures.push(
              formatFailure({
                change: involvedChanges.join(", "),
                capability,
                operation: "CONFLICTING",
                requirement: events[0].name,
                reason: "conflicting archived requirement history: " + terminal.reason,
              }),
            )
            continue
          }

          if (outcomesWithoutChronology.length > 1) {
            if (chronology.source === "fixture") fixtureResolved += 1
            else ancestryResolved += 1
          }

          const terminalRecord =
            [...events].reverse().find((event) => {
              if (terminal.kind === "present") return event.name === terminal.title
              return true
            }) ?? events.at(-1)

          if (terminal.kind === "absent") {
            for (const name of group.names) {
              if (canonical.requirements.has(name)) {
                failures.push(
                  formatFailure({
                    change: terminalRecord.change,
                    capability,
                    operation: terminalRecord.operation,
                    requirement: name,
                    reason:
                      "REMOVED requirement remains in canonical specs; the archived history ends absent for this identity",
                  }),
                )
              }
            }
            continue
          }

          const terminalName = terminal.title
          const canonicalRequirement = canonical.requirements.get(terminalName)

          if (!canonical.exists) {
            failures.push(
              formatFailure({
                change: terminalRecord.change,
                capability,
                operation: terminalRecord.operation,
                requirement: terminalName,
                reason: "canonical capability is missing",
              }),
            )
            continue
          }
          if (!canonicalRequirement) {
            failures.push(
              formatFailure({
                change: terminalRecord.change,
                capability,
                operation: terminalRecord.operation,
                requirement: terminalName,
                reason: 'canonical requirement "' + terminalName + '" is missing',
              }),
            )
            continue
          }
          if (
            terminal.semantics &&
            !sameRequirement(terminal.semantics, canonicalRequirement, {
              ignoreName: true,
            })
          ) {
            failures.push(
              formatFailure({
                change: terminalRecord.change,
                capability,
                operation: terminalRecord.operation,
                requirement: terminalName,
                reason:
                  "canonical requirement is stale; its statement or scenarios do not match the final archived semantic state",
              }),
            )
            continue
          }

          for (const record of events) {
            if (record.operation !== "RENAMED") continue
            if (record.from !== terminalName && canonical.requirements.has(record.from)) {
              failures.push(
                formatFailure({
                  change: record.change,
                  capability,
                  operation: record.operation,
                  requirement: record.from,
                  reason:
                    'historical requirement title remains in canonical specs after explicit evolution to "' +
                    terminalName +
                    '"',
                }),
              )
            }
          }
        }
      }
    } catch (error) {
      failures.push(
        "Compatibility mapping is invalid:\n" +
          (error instanceof Error ? error.message : String(error)),
      )
    }
  }

  if (failures.length > 0) {
    console.error("OpenSpec closure failed:")
    for (const failure of failures) console.error("\n" + failure)
    process.exitCode = 1
    return
  }

  console.log(
    "OpenSpec closure passed:\n" +
      "  " +
      archiveEntries.length +
      " archived changes checked\n" +
      "  " +
      capabilitiesChecked +
      " capabilities checked\n" +
      "  " +
      requirementsChecked +
      " requirements checked\n" +
      "  " +
      scenariosChecked +
      " scenarios checked\n" +
      "  0 closure mismatches\n" +
      "  " +
      compatibilityAliases +
      " explicit legacy compatibility aliases\n" +
      "  " +
      ancestryResolved +
      " ancestry-resolved chronology histories\n" +
      "  " +
      fixtureResolved +
      " injected-fixture chronology histories\n" +
      "  " +
      ambiguousHistories +
      " ambiguous histories\n" +
      "  " +
      legacyArtifacts.length +
      " legacy/unverifiable informational artifacts (outside archived specs/; not silently treated as deltas)",
  )
}

main()
