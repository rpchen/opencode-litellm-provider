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

function gitIsAncestor(left, right) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", left, right], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

function resolveArchiveChronology(archiveEntries) {
  const archiveNames = archiveEntries.map((entry) => entry.name)
  const commitByArchive = new Map()
  let totalOrder = null
  let gitAvailable = true

  for (const name of archiveNames) {
    const archivePath = path.posix.join("openspec/changes/archive", name)
    let commit = ""
    try {
      commit = execFileSync(
        "git",
        ["log", "--diff-filter=A", "--format=%H", "-n", "1", "--", archivePath],
        { encoding: "utf8" },
      ).trim()
    } catch {
      gitAvailable = false
    }
    if (commit) commitByArchive.set(name, commit)
  }

  if (gitAvailable && commitByArchive.size === archiveNames.length) {
    const commits = new Map()
    for (const [archive, commit] of commitByArchive) {
      if (!commits.has(commit)) commits.set(commit, [])
      commits.get(commit).push(archive)
    }
    const uniqueCommits = [...commits.keys()]
    if (uniqueCommits.length === 1) {
      totalOrder = [...archiveNames]
    } else {
      // Determine whether commits form a strict total order by ancestry.
      const sortedCommits = [...uniqueCommits].sort((left, right) => {
        if (left === right) return 0
        if (gitIsAncestor(left, right)) return -1
        if (gitIsAncestor(right, left)) return 1
        return 0
      })
      let comparable = true
      for (let i = 0; i < sortedCommits.length; i += 1) {
        for (let j = i + 1; j < sortedCommits.length; j += 1) {
          if (!gitIsAncestor(sortedCommits[i], sortedCommits[j])) {
            comparable = false
          }
        }
      }
      if (comparable) {
        totalOrder = sortedCommits.flatMap((commit) => commits.get(commit))
      }
    }
  }

  const fixtureOrder = process.env.OPENSPEC_CLOSURE_ORDER_JSON
    ? JSON.parse(process.env.OPENSPEC_CLOSURE_ORDER_JSON)
    : null

  return { totalOrder, fixtureOrder }
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
    const names = [...new Set(capabilityRecords.map((record) => record.name))]
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
        capabilitiesChecked += 1
        requirementsChecked += operations.length
        scenariosChecked += operations.reduce(
          (total, operation) => total + (operation.requirement?.scenarios.length ?? 0),
          0,
        )
        for (const operation of operations) {
          if (operation.operation === "RENAMED") {
            archivedOperations.push({
              capability,
              change: archiveEntry.name,
              operation: "RENAMED",
              name: operation.from,
              from: operation.from,
              to: operation.to,
              present: false,
            })
            archivedOperations.push({
              capability,
              change: archiveEntry.name,
              operation: "RENAMED",
              name: operation.to,
              from: operation.from,
              to: operation.to,
              present: true,
            })
          } else if (operation.operation === "REMOVED") {
            archivedOperations.push({
              capability,
              change: archiveEntry.name,
              operation: "REMOVED",
              name: operation.name,
              present: false,
            })
          } else {
            archivedOperations.push({
              capability,
              change: archiveEntry.name,
              operation: operation.operation,
              name: operation.requirement.name,
              present: true,
              requirement: operation.requirement,
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
  let chronologyReconciliations = 0
  try {
    const compat = loadCompatibilityData(compatFile)
    const chronology = resolveArchiveChronology(archiveEntries)
    const operationGroups = buildOperationGroups(
      archivedOperations,
      compat.requirementAliases,
    )
    compatibilityAliases = operationGroups.compatibilityAliases

    for (const [capability, groups] of operationGroups.groups) {
      const canonical = readCanonical(capability)
      for (const group of groups.values()) {
        // Semantic chronology must be provable. Exact same archive records
        // remain in file order; different archives are ordered by Git
        // introduction commits or an injected fixture order. Lexicographic
        // order is never used for semantics. Ambiguous states fail closed.
        const semanticRecords = group.records.filter(
          (record) => record.requirement,
        )
        const distinctSemanticStates = []
        for (const record of semanticRecords) {
          const existing = distinctSemanticStates.find(
            (state) =>
              state.operation === record.operation &&
              sameRequirement(state.requirement, record.requirement, {
                ignoreName: true,
              }),
          )
          if (!existing) distinctSemanticStates.push(record)
        }

        let terminalSemantic = null
        if (distinctSemanticStates.length === 1) {
          terminalSemantic = distinctSemanticStates[0]
        } else if (distinctSemanticStates.length > 1) {
          const order = chronology.fixtureOrder ?? chronology.totalOrder
          if (!order) {
            failures.push(
              formatFailure({
                change: distinctSemanticStates[0].change,
                capability,
                operation: "AMBIGUOUS",
                requirement: distinctSemanticStates[0].name,
                reason:
                  "ambiguous archived requirement history: multiple semantic states exist for this identity and no reliable chronology proves the final state; changes involved: " +
                  distinctSemanticStates.map((record) => record.change).join(", "),
              }),
            )
            continue
          }
          const ordered = [...distinctSemanticStates].sort((a, b) => {
            const ia = order.indexOf(a.change)
            const ib = order.indexOf(b.change)
            if (ia === -1 || ib === -1) return 0
            return ia - ib
          })
          terminalSemantic = ordered.at(-1)
          chronologyReconciliations += 1
        }

        const explicitRenames = group.records.filter(
          (record) => record.operation === "RENAMED" && record.from && record.to,
        )
        const hasRemoved = group.records.some(
          (record) => record.operation === "REMOVED",
        )

        let terminalName
        let terminalRequirement = null
        let terminalRecord = null
        let removed = false

        if (terminalSemantic) {
          terminalName = terminalSemantic.name
          terminalRequirement = terminalSemantic.requirement
          terminalRecord = terminalSemantic
        }

        // A RENAMED operation without a later semantic delta still migrates
        // the terminal title while keeping the semantic content.
        if (!hasRemoved && explicitRenames.length > 0) {
          const lastRename = explicitRenames.at(-1)
          terminalName = lastRename.to
          if (!terminalRecord) terminalRecord = lastRename
        }

        if (!terminalRecord && hasRemoved) {
          terminalRecord = group.records
            .filter((record) => record.operation === "REMOVED")
            .at(-1)
          terminalName = terminalRecord.name
          removed = true
        }

        if (!terminalRecord) {
          terminalRecord = group.records.at(-1)
          terminalName = terminalRecord.name
        }

        const canonicalRequirement = terminalName
          ? canonical.requirements.get(terminalName)
          : null

        if (removed) {
          if (canonicalRequirement) {
            failures.push(
              formatFailure({
                change: terminalRecord.change,
                capability,
                operation: terminalRecord.operation,
                requirement: terminalName,
                reason: "REMOVED requirement remains in canonical specs",
              }),
            )
          }
          continue
        }

        if (terminalName) {
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
            terminalRequirement &&
            !sameRequirement(terminalRequirement, canonicalRequirement, {
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
                  "canonical requirement is stale; its statement or scenarios do not match any final archived semantic state",
              }),
            )
            continue
          }
        }

        for (const rename of explicitRenames) {
          if (rename.from !== terminalName && canonical.requirements.has(rename.from)) {
            failures.push(
              formatFailure({
                change: rename.change,
                capability,
                operation: rename.operation,
                requirement: rename.from,
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
      chronologyReconciliations +
      " explicit chronology reconciliations\n" +
      "  " +
      legacyArtifacts.length +
      " legacy/unverifiable informational artifacts (outside archived specs/; not silently treated as deltas)",
  )
}

main()
