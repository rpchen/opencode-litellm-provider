#!/usr/bin/env node
/**
 * Pure eligibility helpers for reusing a successful real-host E2E baseline.
 *
 * Everything exported here is a decision function over facts that someone else
 * already collected: no network, no GitHub API, no installation, no writes.
 * Three independent questions have to be answered with "delivery" before the
 * isolated behaviour matrix may be replaced by the targeted verification of the
 * current candidate:
 *
 *   compareGitInputs({ root, baselineCandidate, candidate, baselineHarness, harness })
 *     Are the two pairs of Git trees (installed candidate, harness) identical
 *     except for the explicitly allowed version/documentation fields?
 *   checkFullBaseline({ baseline, repository, requiredGroups })
 *     Is the recorded baseline really one complete, successful matrix run that
 *     this repository owns?
 *   compareHostInputs({ baseline, current })
 *     Do the recorded host input, host lock digest and fixed configuration
 *     describe the same runtime input surface?
 *
 * A "full" verdict means "run the complete matrix". Nothing here can prove that
 * a baseline run is honest; the caller still has to re-read the workflow/check
 * facts on GitHub, and the baseline artifact is not the final source of truth.
 * The module is generic on purpose: the Pi adapter only changes the host package
 * and `requiredGroups`, and no Core business algorithm is duplicated here.
 */

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { isDeepStrictEqual } from "node:util"

/** Verdicts shared by every comparison helper. */
export const DELIVERY_VERDICT = "delivery"
export const FULL_VERDICT = "full"

/** Fixed group ids of the two adapters' complete real-host matrices. */
export const OPENCODE_REQUIRED_GROUPS = ["A", "B", "C", "D"]
export const PI_REQUIRED_GROUPS = ["pi"]

export const README_PATH = "README.md"
export const PACKAGE_MANIFEST_PATH = "package.json"
export const PACKAGE_LOCK_PATH = "package-lock.json"
export const RUNTIME_IDENTITY_PATH = "dist/runtime-identity.json"

/** Release notes that belong to one exact version (never a whole `docs/` tree). */
export function releaseNotesPath(version) {
  return `docs/releases/v${version}.md`
}

const SHA_PATTERN = /^[0-9a-f]{40}$/u
const GIT_MAX_BUFFER = 512 * 1024 * 1024
const VERSION_STRING_PATTERN = /^\d+\.\d+\.\d+$/u

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function firstLine(text) {
  return String(text ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line !== "") ?? ""
}

function runGit({ root, args }) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: GIT_MAX_BUFFER,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C", GIT_PAGER: "cat" },
  })
  return {
    ok: result.error === undefined && result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  }
}

/** Public, path-free-enough failure text: never swallow a comparison error. */
function gitFailure(result, what) {
  if (result.error) return `${what}: ${result.error.message}`
  return `${what}: ${firstLine(result.stderr) || `git exited with ${result.status}`}`
}

/**
 * Resolve one comparison input to the commit and tree that Git actually holds.
 * Only full lowercase SHAs are accepted so that a branch name or `HEAD` cannot
 * drift between classification and execution.
 */
function resolveCommit({ root, rev, label }) {
  if (typeof rev !== "string" || rev.trim() === "") return { ok: false, reason: `${label} is missing` }
  if (!SHA_PATTERN.test(rev)) {
    return { ok: false, reason: `${label} must be a full 40-character lowercase commit SHA, got ${JSON.stringify(rev)}` }
  }
  const commit = runGit({ root, args: ["rev-parse", "--verify", `${rev}^{commit}`] })
  if (!commit.ok) return { ok: false, reason: gitFailure(commit, `cannot resolve ${label} ${rev}`) }
  const sha = commit.stdout.trim()
  const tree = runGit({ root, args: ["rev-parse", "--verify", `${sha}^{tree}`] })
  if (!tree.ok) return { ok: false, reason: gitFailure(tree, `cannot read the tree of ${label} ${rev}`) }
  return { ok: true, sha, tree: tree.stdout.trim() }
}

/**
 * Complete `git ls-tree -r` inventory of a tree: every path with its mode, type
 * and object id. Working-tree state, `.gitignore` and the artifact digest are
 * deliberately irrelevant here.
 */
function listTree({ root, tree, label }) {
  const result = runGit({ root, args: ["ls-tree", "-r", "-z", "--full-tree", tree] })
  if (!result.ok) return { ok: false, reason: gitFailure(result, `cannot list the tree of ${label}`) }
  const entries = new Map()
  for (const record of result.stdout.split("\0")) {
    if (record === "") continue
    const tab = record.indexOf("\t")
    if (tab < 0) return { ok: false, reason: `unexpected git ls-tree output for ${label}` }
    const [mode, type, object] = record.slice(0, tab).split(" ")
    if (!mode || !type || !object) return { ok: false, reason: `unexpected git ls-tree entry for ${label}` }
    entries.set(record.slice(tab + 1), { mode, type, object })
  }
  return { ok: true, entries }
}

/** Added, modified and deleted paths between two complete inventories. */
function diffTrees(baselineEntries, currentEntries) {
  const changes = []
  for (const [file, before] of baselineEntries) {
    const after = currentEntries.get(file)
    if (!after) {
      changes.push({ path: file, status: "deleted", before, after: null })
      continue
    }
    if (before.object !== after.object || before.mode !== after.mode || before.type !== after.type) {
      changes.push({ path: file, status: "modified", before, after })
    }
  }
  for (const [file, after] of currentEntries) {
    if (!baselineEntries.has(file)) changes.push({ path: file, status: "added", before: null, after })
  }
  return changes.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
}

function readBlob({ root, entries, file, label }) {
  const entry = entries.get(file)
  if (!entry) return { ok: false, reason: `${label} ${file} is missing from the tree` }
  if (entry.type !== "blob") return { ok: false, reason: `${label} ${file} is not a regular file (git type ${entry.type})` }
  const result = runGit({ root, args: ["cat-file", "blob", entry.object] })
  if (!result.ok) return { ok: false, reason: gitFailure(result, `cannot read ${label} ${file}`) }
  return { ok: true, text: result.stdout }
}

function readJsonBlob({ root, entries, file, label }) {
  const blob = readBlob({ root, entries, file, label })
  if (!blob.ok) return blob
  try {
    return { ok: true, json: JSON.parse(blob.text) }
  } catch {
    return { ok: false, reason: `${label} ${file} is not valid JSON` }
  }
}

function omitKeys(object, keys) {
  if (!isPlainObject(object)) return object
  const copy = { ...object }
  for (const key of keys) delete copy[key]
  return copy
}

/** Root version plus `packages[""].version`; every other lock byte/field stays. */
function stripLockRootVersions(lock) {
  if (!isPlainObject(lock)) return lock
  const copy = omitKeys(lock, ["version"])
  if (isPlainObject(lock.packages) && isPlainObject(lock.packages[""])) {
    copy.packages = { ...lock.packages, "": omitKeys(lock.packages[""], ["version"]) }
  }
  return copy
}

/** JSON paths where only the named version fields may differ. */
const VERSION_JSON_RULES = new Map([
  [PACKAGE_MANIFEST_PATH, { strip: (json) => omitKeys(json, ["version"]), description: "the root version field" }],
  [PACKAGE_LOCK_PATH, { strip: stripLockRootVersions, description: "the root version fields" }],
  [RUNTIME_IDENTITY_PATH, { strip: (json) => omitKeys(json, ["pluginVersion"]), description: "the pluginVersion field" }],
])

/**
 * Read the delivery version of one tree and require the three places that carry
 * it to agree: manifest version, both lock versions, identity pluginVersion.
 */
function readDeliveryVersion({ root, entries, label }) {
  const failures = []
  const manifest = readJsonBlob({ root, entries, file: PACKAGE_MANIFEST_PATH, label })
  const lock = readJsonBlob({ root, entries, file: PACKAGE_LOCK_PATH, label })
  const identity = readJsonBlob({ root, entries, file: RUNTIME_IDENTITY_PATH, label })
  for (const read of [manifest, lock, identity]) if (!read.ok) failures.push(read.reason)
  if (failures.length > 0) return { ok: false, failures }

  const version = isPlainObject(manifest.json) ? manifest.json.version : undefined
  if (typeof version !== "string" || !VERSION_STRING_PATTERN.test(version)) {
    failures.push(`${label} ${PACKAGE_MANIFEST_PATH} version ${JSON.stringify(version)} is not an exact x.y.z version`)
  }
  const lockVersion = isPlainObject(lock.json) ? lock.json.version : undefined
  if (lockVersion !== version) failures.push(`${label} ${PACKAGE_LOCK_PATH} version ${JSON.stringify(lockVersion)} != ${JSON.stringify(version)}`)
  const lockRootVersion = isPlainObject(lock.json?.packages?.[""]) ? lock.json.packages[""].version : undefined
  if (lockRootVersion !== version) {
    failures.push(`${label} ${PACKAGE_LOCK_PATH} packages[""].version ${JSON.stringify(lockRootVersion)} != ${JSON.stringify(version)}`)
  }
  const pluginVersion = isPlainObject(identity.json) ? identity.json.pluginVersion : undefined
  if (pluginVersion !== version) {
    failures.push(`${label} ${RUNTIME_IDENTITY_PATH} pluginVersion ${JSON.stringify(pluginVersion)} != ${JSON.stringify(version)}`)
  }
  if (failures.length > 0) return { ok: false, failures }
  return { ok: true, version }
}

/**
 * Classify one changed path. `null` means the change is an allowed delivery
 * input change; anything else is a public reason for a complete matrix run.
 */
function classifyChange({ root, change, version, side }) {
  if (version === null) return `${side} ${change.path}: changed, but the delivery version needed to allow a version-only change is unknown`
  const { path: file, status, before, after } = change
  const what = `${side} ${file}`
  if (before && after && (before.mode !== after.mode || before.type !== after.type)) {
    return `${what}: file mode or type changed (${before.mode}/${before.type} -> ${after.mode}/${after.type})`
  }
  const notes = releaseNotesPath(version)
  if (status === "deleted") {
    if (file === notes || file.startsWith("docs/releases/")) return `${what}: release notes may not be deleted`
    return `${what}: removed files are not an allowed input change`
  }
  if (status === "added") {
    return file === notes ? null : `${what}: added files are not an allowed input change`
  }
  if (file === README_PATH || file === notes) return null

  const rule = VERSION_JSON_RULES.get(file)
  if (!rule) return `${what}: changed and is not an allowed version-only input path`
  const baselineJson = readJsonBlob({ root, entries: change.entries.baseline, file, label: `baseline ${side}` })
  if (!baselineJson.ok) return `${what}: ${baselineJson.reason}`
  const currentJson = readJsonBlob({ root, entries: change.entries.current, file, label: `current ${side}` })
  if (!currentJson.ok) return `${what}: ${currentJson.reason}`
  if (isDeepStrictEqual(rule.strip(baselineJson.json), rule.strip(currentJson.json))) return null
  return `${what}: changed beyond ${rule.description}`
}

function emptySide() {
  return { baseline: null, current: null, changedPaths: [] }
}

function publicChange(change) {
  return {
    path: change.path,
    status: change.status,
    before: change.before ? { mode: change.before.mode, type: change.before.type, object: change.before.object } : null,
    after: change.after ? { mode: change.after.mode, type: change.after.type, object: change.after.object } : null,
  }
}

/**
 * Compare the installed candidate and the harness as two independent pairs of
 * Git trees (current → baseline). Both pairs must be tree-identical apart from
 * the allowed version/documentation fields; the two pairs are never mixed.
 */
export function compareGitInputs({ root, baselineCandidate, candidate, baselineHarness, harness } = {}) {
  const failures = []
  const result = { candidate: emptySide(), harness: emptySide() }

  const finish = (version = null) => {
    const ok = failures.length === 0
    return {
      ok,
      verdict: ok ? DELIVERY_VERDICT : FULL_VERDICT,
      reason: ok
        ? `only allowed version and documentation inputs changed from the baseline (version ${version})`
        : failures.join("; "),
      failures,
      version,
      candidate: result.candidate,
      harness: result.harness,
    }
  }

  if (typeof root !== "string" || root.trim() === "") {
    failures.push("root must be the repository directory that holds the baseline objects")
    return finish()
  }

  const sides = [
    { key: "candidate", baselineRev: baselineCandidate, currentRev: candidate },
    { key: "harness", baselineRev: baselineHarness, currentRev: harness },
  ]

  const trees = {}
  for (const { key, baselineRev, currentRev } of sides) {
    const baseline = resolveCommit({ root, rev: baselineRev, label: `baseline ${key}` })
    const current = resolveCommit({ root, rev: currentRev, label: `current ${key}` })
    for (const resolved of [baseline, current]) if (!resolved.ok) failures.push(resolved.reason)
    if (!baseline.ok || !current.ok) continue
    result[key].baseline = { sha: baseline.sha, tree: baseline.tree }
    result[key].current = { sha: current.sha, tree: current.tree }
    const baselineEntries = listTree({ root, tree: baseline.tree, label: `baseline ${key}` })
    const currentEntries = listTree({ root, tree: current.tree, label: `current ${key}` })
    for (const listed of [baselineEntries, currentEntries]) if (!listed.ok) failures.push(listed.reason)
    if (!baselineEntries.ok || !currentEntries.ok) continue
    trees[key] = { baseline: baselineEntries.entries, current: currentEntries.entries }
  }

  // Version consistency is required for every tree that was read, including the
  // baseline: an inconsistent baseline cannot describe a delivered candidate.
  const versions = {}
  const labels = {
    candidate: { baseline: "baseline candidate", current: "current candidate" },
    harness: { baseline: "baseline harness", current: "current harness" },
  }
  for (const key of Object.keys(trees)) {
    for (const side of ["baseline", "current"]) {
      const read = readDeliveryVersion({ root, entries: trees[key][side], label: labels[key][side] })
      if (!read.ok) failures.push(...read.failures)
      else versions[`${key}.${side}`] = read.version
    }
  }

  const version = versions["candidate.current"] ?? null
  if (version === null && trees.candidate) {
    failures.push("the current candidate version could not be established, so no version-only change can be accepted")
  }

  if (trees.candidate && version !== null) {
    const changes = diffTrees(trees.candidate.baseline, trees.candidate.current)
    result.candidate.changedPaths = changes.map(publicChange)
    for (const change of changes) {
      const problem = classifyChange({
        root,
        change: { ...change, entries: trees.candidate },
        version,
        side: "candidate",
      })
      if (problem) failures.push(problem)
    }
  }

  if (trees.harness) {
    const changes = diffTrees(trees.harness.baseline, trees.harness.current)
    result.harness.changedPaths = changes.map(publicChange)
    for (const change of changes) {
      const problem = classifyChange({
        root,
        change: { ...change, entries: trees.harness },
        version,
        side: "harness",
      })
      if (problem) failures.push(problem)
    }
  }

  return finish(version)
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

/** A group result is either the result string or an object carrying `result`. */
function groupResult(value) {
  if (typeof value === "string") return value.trim() === "" ? undefined : value.trim()
  if (isPlainObject(value) && typeof value.result === "string") return value.result
  return undefined
}

/**
 * Require the recorded baseline to be one complete matrix success of this
 * repository: `kind: "full"`, exactly the adapter's groups, every group
 * `success`, a real run id and attempt. This proves the record's own shape and
 * completeness only; the caller still re-reads the GitHub run, its jobs and the
 * required check, because a stored artifact is not the final source of truth.
 */
export function checkFullBaseline({ baseline, repository, requiredGroups = OPENCODE_REQUIRED_GROUPS } = {}) {
  const failures = []
  const groups = Array.isArray(requiredGroups) ? requiredGroups.map((group) => String(group)) : []
  if (groups.length === 0) failures.push("requiredGroups must be a non-empty array of group ids")
  if (new Set(groups).size !== groups.length) failures.push("requiredGroups contains duplicate group ids")
  if (typeof repository !== "string" || repository.trim() === "") {
    failures.push("repository (owner/name) is required so the baseline can be tied to this repository")
  }
  if (!isPlainObject(baseline)) {
    failures.push("the baseline record is missing or not an object")
    return { ok: false, failures, observed: {} }
  }

  const observed = {
    kind: baseline.kind,
    repository: baseline.repository,
    runId: baseline.runId,
    runAttempt: baseline.runAttempt,
    groups: isPlainObject(baseline.groups) ? Object.keys(baseline.groups).sort() : null,
  }

  if (baseline.kind !== FULL_VERDICT) {
    failures.push(`baseline kind ${JSON.stringify(baseline.kind)} is not "${FULL_VERDICT}"; only a complete matrix run may be reused`)
  }
  if (!isPlainObject(baseline.groups)) {
    failures.push("the baseline groups are missing or not an object")
  } else {
    for (const group of groups) {
      const result = groupResult(baseline.groups[group])
      if (result === undefined) failures.push(`required group "${group}" is missing from the baseline`)
      else if (result !== "success") failures.push(`required group "${group}" finished with ${JSON.stringify(result)}, expected "success"`)
    }
    for (const group of Object.keys(baseline.groups)) {
      if (!groups.includes(group)) failures.push(`unexpected group "${group}" in the baseline`)
    }
  }
  if (!isPositiveInteger(baseline.runId)) {
    failures.push(`baseline runId ${JSON.stringify(baseline.runId)} is not a positive integer`)
  }
  if (!isPositiveInteger(baseline.runAttempt)) {
    failures.push(`baseline runAttempt ${JSON.stringify(baseline.runAttempt)} is not a positive integer`)
  }
  if (typeof repository === "string" && repository.trim() !== "" && baseline.repository !== repository) {
    failures.push(`baseline repository ${JSON.stringify(baseline.repository)} is not ${JSON.stringify(repository)}`)
  }

  return { ok: failures.length === 0, failures, observed }
}

/** Host-input fields that must match exactly, as nested key paths. */
export const HOST_INPUT_REQUIRED_FIELDS = [
  ["hostPackage"],
  ["hostVersion"],
  ["node"],
  ["npm"],
  ["os", "platform"],
  ["os", "arch"],
  ["runner", "ImageOS"],
  ["runner", "ImageVersion"],
]

/**
 * Fields recorded per run that are expected to differ and are never part of the
 * reusable input surface: the timestamp, the temporary install path, the
 * candidate locator (checked by `compareGitInputs`) and the VM kernel release.
 */
export const HOST_INPUT_IGNORED_FIELDS = [
  "resolvedAt",
  "hostBin",
  "candidateSha",
  "packageSpec",
  "hostLock",
  "os.release",
]

const HOST_INPUT_ALLOWED_KEYS = {
  "": new Set([
    "hostPackage",
    "hostVersion",
    "node",
    "npm",
    "os",
    "runner",
    "resolvedAt",
    "hostBin",
    "candidateSha",
    "packageSpec",
    "hostLock",
  ]),
  os: new Set(["platform", "arch", "release"]),
  runner: new Set(["ImageOS", "ImageVersion"]),
}

/** Byte digest of a host manifest/lock pair, e.g. `sha256:<hex>`. */
export const HOST_LOCK_SEPARATOR = "\n--e2e-host-lock--\n"

export function digestHostLock({ packageJson, packageLock } = {}) {
  const manifest = toBuffer(packageJson, "packageJson")
  const lock = toBuffer(packageLock, "packageLock")
  const hash = createHash("sha256")
  hash.update(manifest)
  hash.update(Buffer.from(HOST_LOCK_SEPARATOR, "utf8"))
  hash.update(lock)
  return `sha256:${hash.digest("hex")}`
}

function toBuffer(value, label) {
  if (Buffer.isBuffer(value)) return value
  if (typeof value === "string") return Buffer.from(value, "utf8")
  throw new Error(`${label} must be a string or Buffer of the host lock bytes`)
}

function valueAt(object, path) {
  return path.reduce((current, key) => (isPlainObject(current) ? current[key] : undefined), object)
}

function checkHostInputShape({ hostInput, label, failures }) {
  if (!isPlainObject(hostInput)) {
    failures.push(`${label} host input is missing or not an object`)
    return false
  }
  for (const [container, allowed] of Object.entries(HOST_INPUT_ALLOWED_KEYS)) {
    const target = container === "" ? hostInput : hostInput[container]
    if (target === undefined) continue
    if (!isPlainObject(target)) {
      failures.push(`${label} host input field "${container || "record"}" is not an object`)
      continue
    }
    for (const key of Object.keys(target)) {
      if (!allowed.has(key)) failures.push(`${label} host input has unexpected field "${container === "" ? key : `${container}.${key}`}"`)
    }
  }
  for (const path of HOST_INPUT_REQUIRED_FIELDS) {
    const value = valueAt(hostInput, path)
    const name = path.join(".")
    if (value === undefined) failures.push(`${label} host input field ${name} is missing`)
    else if (value === null) failures.push(`${label} host input field ${name} is null`)
    else if (typeof value !== "string" || value.trim() === "") failures.push(`${label} host input field ${name} is empty`)
  }
  return true
}

function differenceKeys(left, right) {
  const keys = new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])
  return [...keys].filter((key) => !isDeepStrictEqual(left?.[key], right?.[key])).sort()
}

/**
 * Compare the recorded host input of a baseline with the current run.
 *
 * Each side is `{ hostInput, lockDigest, config }`, where `hostInput` is the
 * real `host-input.json` record (extra locator fields are ignored, see
 * `HOST_INPUT_IGNORED_FIELDS`), `lockDigest` comes from `digestHostLock` and
 * `config` holds the fixed install/run settings of that run. Missing or empty
 * metadata fails closed: no reusable input, complete matrix run.
 */
export function compareHostInputs({ baseline, current } = {}) {
  const failures = []
  const sides = [
    { key: "baseline", side: baseline },
    { key: "current", side: current },
  ]

  const finish = () => {
    const ok = failures.length === 0
    return {
      ok,
      verdict: ok ? DELIVERY_VERDICT : FULL_VERDICT,
      reason: ok ? "host input, lock digest and fixed configuration match the baseline" : failures.join("; "),
      failures,
      compared: {
        hostPackage: current?.hostInput?.hostPackage ?? null,
        hostVersion: current?.hostInput?.hostVersion ?? null,
      },
    }
  }

  const usable = {}
  for (const { key, side } of sides) {
    if (!isPlainObject(side)) {
      failures.push(`${key} host comparison side is missing or not an object`)
      continue
    }
    const inputOk = checkHostInputShape({ hostInput: side.hostInput, label: key, failures })
    if (typeof side.lockDigest !== "string" || side.lockDigest.trim() === "") {
      failures.push(`${key} host lock digest is missing or empty`)
    }
    if (!isPlainObject(side.config) || Object.keys(side.config).length === 0) {
      failures.push(`${key} fixed configuration is missing or empty`)
    }
    usable[key] = inputOk
  }
  if (!usable.baseline || !usable.current) return finish()

  for (const path of HOST_INPUT_REQUIRED_FIELDS) {
    const name = path.join(".")
    const left = valueAt(baseline.hostInput, path)
    const right = valueAt(current.hostInput, path)
    if (typeof left === "string" && typeof right === "string" && left !== right) {
      failures.push(`${name} differs: baseline ${JSON.stringify(left)} vs current ${JSON.stringify(right)}`)
    }
  }
  if (typeof baseline.lockDigest === "string" && baseline.lockDigest !== current.lockDigest) {
    failures.push(`host lock digest differs: baseline ${JSON.stringify(baseline.lockDigest)} vs current ${JSON.stringify(current.lockDigest)}`)
  }
  if (isPlainObject(baseline.config) && isPlainObject(current.config) && !isDeepStrictEqual(baseline.config, current.config)) {
    failures.push(`fixed configuration differs: ${differenceKeys(baseline.config, current.config).join(", ") || "(unknown)"}`)
  }

  return finish()
}
