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

const requirementHeader = /^###\s+Requirement:\s*(.+?)\s*$/i
const scenarioHeader = /^####\s+(.+?)\s*$/

function normalizeLineEndings(content) {
  return content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")
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

function requirementNameSimilarity(left, right) {
  const a = Array.from(left.toLowerCase())
  const b = Array.from(right.toLowerCase())
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row]
    for (let column = 1; column <= b.length; column += 1) {
      current[column] =
        a[row - 1] === b[column - 1]
          ? previous[column - 1]
          : 1 +
            Math.min(previous[column - 1], previous[column], current[column - 1])
    }
    for (let column = 0; column <= b.length; column += 1) {
      previous[column] = current[column]
    }
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length, 1)
}

function buildOperationGroups(records) {
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
  let legacyAliases = 0
  for (const [capability, capabilityRecords] of byCapability) {
    const names = [
      ...new Set(capabilityRecords.map((record) => record.name)),
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

    for (const record of capabilityRecords) {
      if (record.operation !== "MODIFIED") continue
      const candidates = capabilityRecords
        .filter(
          (candidate) =>
            candidate.name !== record.name &&
            (candidate.operation === "ADDED" ||
              candidate.operation === "MODIFIED"),
        )
        .map((candidate) => candidate.name)
        .filter((name, index, all) => all.indexOf(name) === index)
        .map((name) => ({
          name,
          similarity: requirementNameSimilarity(record.name, name),
        }))
        .filter((candidate) => candidate.similarity >= 0.8)
        .sort((left, right) => right.similarity - left.similarity)
      if (
        candidates.length > 0 &&
        (candidates.length === 1 ||
          candidates[0].similarity - candidates[1].similarity >= 0.05)
      ) {
        union(record.name, candidates[0].name)
        legacyAliases += 1
      }
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
    for (const group of grouped.values()) {
      const modified = group.records.filter(
        (record) => record.operation === "MODIFIED",
      )
      const removed = group.records.filter(
        (record) => record.operation === "REMOVED",
      )
      if (removed.length > 0 && modified.length === 0) {
        group.terminalRecords = removed
      } else if (modified.length > 0) {
        group.terminalRecords = [modified.at(-1)]
      } else {
        group.terminalRecords = [group.records.at(-1)]
      }
    }
    groups.set(capability, grouped)
  }
  return { groups, legacyAliases }
}

function formatFailure({ change, capability, operation, requirement, reason }) {
  const requirementLine = requirement ? "\nrequirement: " + requirement : ""
  return (
    "Archived OpenSpec change is not reflected in canonical specs:\n" +
    "change: " +
    change +
    "\n" +
    "capability: " +
    capability +
    "\n" +
    "operation: " +
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
    "\n" +
    "capability: " +
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
              present: false,
            })
            archivedOperations.push({
              capability,
              change: archiveEntry.name,
              operation: "RENAMED",
              name: operation.to,
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

  const operationGroups = buildOperationGroups(archivedOperations)
  for (const [capability, groups] of operationGroups.groups) {
    const canonical = readCanonical(capability)
    for (const group of groups.values()) {
      const presentRecords = group.terminalRecords.filter(
        (record) => record.present,
      )
      const actualRequirements = canonical.exists
        ? [...group.names]
            .map((name) => canonical.requirements.get(name))
            .filter(Boolean)
        : []
      const representative =
        presentRecords.at(-1) ?? group.records.at(-1)

      if (presentRecords.length > 0) {
        const matchingRecord = presentRecords.find((record) => {
          if (!record.requirement) return actualRequirements.length > 0
          return actualRequirements.some((actual) =>
            sameRequirement(record.requirement, actual, {
              ignoreName:
                group.names.size > 1 && actual.name !== record.requirement.name,
            }),
          )
        })
        if (matchingRecord) continue

        const context = {
          change: representative.change,
          capability,
          operation: representative.operation,
          requirement: representative.name,
        }
        failures.push(
          formatFailure({
            ...context,
            reason: !canonical.exists
              ? "canonical capability is missing"
              : actualRequirements.length === 0
                ? "canonical requirement is missing"
                : "canonical requirement is stale; its statement or scenarios do not match any final archived semantic state",
          }),
        )
      } else if (actualRequirements.length > 0) {
        const context = {
          change: representative.change,
          capability,
          operation: representative.operation,
          requirement: representative.name,
        }
        failures.push(
          formatFailure({
            ...context,
            reason: "REMOVED requirement remains in canonical specs",
          }),
        )
      }
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
      operationGroups.legacyAliases +
      " legacy title reconciliations (explicit compatibility for archived MODIFIED headers)",
      "\n  " +
      legacyArtifacts.length +
      " legacy/unverifiable informational artifacts (outside archived specs/; not silently treated as deltas)",
  )
}

main()
