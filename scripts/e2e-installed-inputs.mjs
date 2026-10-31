/**
 * Actual installed-package evidence for the real-host E2E gate.
 *
 * A reusable baseline may only replace the complete behaviour matrix when the
 * runtime dependency surface of the *actually installed* candidate is the same
 * as the baseline's. This module reads that evidence from the E2E run's own
 * throw-away HOME/XDG directories:
 *
 *   locateInstalledCandidate({ roots, workspace })
 *     Find the installed candidate package (a directory whose `dist` holds both
 *     `runtime-identity.json` and `core-provenance.json`) strictly below `roots`,
 *     which themselves must be inside `workspace`.
 *   readInstalledPackage({ root })
 *     Read the installed `package.json`, `dist/runtime-identity.json` and
 *     `dist/core-provenance.json` of that package.
 *   normalizeInstalledLock({ lock, packageName, candidateSha })
 *     Reduce the installed package's *actual ancestor* npm lock to the external
 *     dependency entries that describe the runtime surface. The empty root entry
 *     and the candidate's own entry are excluded (they carry the candidate
 *     locator/version, which the Git input comparison already covers).
 *   collectDeliveryInputs({ roots, workspace, candidateSha, expectedIdentity, expectedProvenance })
 *     The `deliveryInputs` report object. Any missing, ambiguous or unsafe
 *     evidence yields `{ complete: false, reason }` instead of a guess, so the
 *     caller can only ever fail closed towards the complete matrix run.
 *
 * Nothing here reads the user's real HOME, credentials or configuration: the
 * search roots are required to live inside the caller's temporary E2E
 * workspace, symlinked directories are never followed, and the returned object
 * contains no absolute paths, no raw endpoint URL and no credential value.
 *
 * The interface is host-generic on purpose: only `packageName`, the identity
 * files and the lock layout are adapter facts. The Pi adapter installs from a
 * Git clone instead of an npm store, so it supplies its own evidence source and
 * keeps the same `{ complete, reason?, ... }` contract.
 */
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"

/** Installed package facts shared by the OpenCode adapter and its E2E script. */
export const CANDIDATE_PACKAGE_NAME = "opencode-litellm-provider"
export const RUNTIME_IDENTITY_FILE = "runtime-identity.json"
export const PROVENANCE_FILE = "core-provenance.json"
export const LOCKFILE_NAME = "package-lock.json"
export const DIST_DIR = "dist"

/** Depth limit for the store scan: the install path nests a few known levels. */
const MAX_SCAN_DEPTH = 8

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function readJsonFile(file, what) {
  let text
  try {
    text = readFileSync(file, "utf8")
  } catch (error) {
    throw new Error(`${what} could not be read (${error?.code ?? "read failed"})`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${what} is not valid JSON`)
  }
}

/**
 * Find every directory holding a complete candidate `dist` below `roots`.
 *
 * Symlinked directories are skipped, so a store link cannot make the scan read
 * a path outside the run's own directories.
 */
export function findInstalledCandidates({ roots, workspace }) {
  if (!Array.isArray(roots) || roots.length === 0) throw new Error("candidate search roots are required")
  if (!workspace) throw new Error("the temporary E2E workspace is required to bound the search")
  for (const root of roots) {
    if (!isInside(workspace, root)) {
      throw new Error(`candidate search root ${JSON.stringify(path.basename(String(root)))} is outside the temporary E2E workspace`)
    }
  }
  const found = []
  const seen = new Set()
  const visit = (dir, depth) => {
    if (depth > MAX_SCAN_DEPTH || found.some((entry) => dir.startsWith(`${entry.root}${path.sep}`))) return
    let real
    try {
      real = path.resolve(dir)
      if (seen.has(real)) return
      seen.add(real)
    } catch {
      return
    }
    let names
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    const distDir = path.join(dir, DIST_DIR)
    if (names.includes(DIST_DIR)) {
      try {
        const inside = readdirSync(distDir)
        if (inside.includes(RUNTIME_IDENTITY_FILE) && inside.includes(PROVENANCE_FILE)) {
          found.push({ root: dir, distDir })
          return
        }
      } catch {
        // An unreadable dist cannot be the installed candidate.
      }
    }
    for (const name of names) {
      const child = path.join(dir, name)
      let stats
      try {
        stats = lstatSync(child)
      } catch {
        continue
      }
      if (stats.isSymbolicLink() || !stats.isDirectory()) continue
      visit(child, depth + 1)
    }
  }
  for (const root of roots) visit(root, 0)
  return found
}

/**
 * Locate the one installed candidate package below the run's own directories.
 *
 * Returns the absolute `{ root, distDir, manifestPath }` for internal use. More
 * than one generation is ambiguous evidence: the caller cannot tell which copy
 * the host loaded, so this returns them all and lets the caller refuse.
 */
export function locateInstalledCandidates({ roots, workspace }) {
  return findInstalledCandidates({ roots, workspace }).map((entry) => ({
    ...entry,
    manifestPath: path.join(entry.root, "package.json"),
  }))
}

/** Read the installed package manifest, Runtime Identity and Core provenance. */
export function readInstalledPackage({ root, packageName = CANDIDATE_PACKAGE_NAME }) {
  if (!root) throw new Error("an installed package directory is required")
  const manifest = readJsonFile(path.join(root, "package.json"), "the installed package manifest")
  if (!isPlainObject(manifest) || manifest.name !== packageName) {
    throw new Error(`the installed package manifest is not ${packageName}`)
  }
  const identity = readJsonFile(path.join(root, DIST_DIR, RUNTIME_IDENTITY_FILE), "the installed Runtime Identity")
  const provenance = readJsonFile(path.join(root, DIST_DIR, PROVENANCE_FILE), "the installed Core provenance")
  if (!isPlainObject(identity) || !isPlainObject(provenance)) {
    throw new Error("the installed Runtime Identity or Core provenance is not an object")
  }
  if (manifest.version !== identity.pluginVersion) {
    throw new Error("the installed package version does not match its Runtime Identity")
  }
  if (provenance.sha !== identity.coreCommit) {
    throw new Error("the installed Core provenance does not match the Runtime Identity")
  }
  return { manifest, identity, provenance }
}

/**
 * Walk up from the installed package to its *actual* ancestor npm lock.
 *
 * The nearest `package-lock.json` above `node_modules/<package>` is the lock the
 * install command that produced this copy wrote; nothing above it describes the
 * runtime surface. A missing lock is a real limit, not something to synthesise.
 */
export function findAncestorLock({ root, workspace }) {
  if (!workspace) throw new Error("the temporary E2E workspace is required to bound the lock search")
  let directory = path.dirname(path.resolve(root))
  for (let depth = 0; depth < MAX_SCAN_DEPTH; depth += 1) {
    if (!isInside(workspace, directory)) return null
    const candidate = path.join(directory, LOCKFILE_NAME)
    if (existsSync(candidate)) return { lockPath: candidate, lockDir: directory }
    const parent = path.dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return null
}

const LOCAL_PATH_PATTERN = /^(?:file:|[A-Za-z]:[\\/]|\\\\|\/)/u

function entryKey(packageName) {
  return `node_modules/${packageName}`
}

/**
 * Normalise the installed package's ancestor lock into external evidence.
 *
 * Only the two entries that describe *this candidate* are dropped: the empty
 * root entry (`""`, whose `dependencies` carry the candidate's Git locator) and
 * the candidate's own `node_modules/<packageName>` entry (its `version` and
 * `resolved` change with every candidate commit). Everything else is preserved
 * verbatim — `version`, `resolved`, `integrity` and the dependency mode flags.
 */
export function normalizeInstalledLock({ lock, packageName = CANDIDATE_PACKAGE_NAME, candidateSha } = {}) {
  if (!isPlainObject(lock)) throw new Error("the installed npm lock is not an object")
  if (!isPlainObject(lock.packages)) throw new Error("the installed npm lock has no packages section")
  const entries = lock.packages
  const own = entryKey(packageName)
  const ownEntry = entries[own]
  if (!isPlainObject(ownEntry)) {
    throw new Error(`the installed npm lock has no ${own} entry, so it does not describe the installed candidate`)
  }
  if (candidateSha) {
    const resolved = typeof ownEntry.resolved === "string" ? ownEntry.resolved : ""
    if (!resolved.endsWith(`#${candidateSha}`)) {
      throw new Error("the installed npm lock does not bind the installed candidate commit")
    }
  }
  const packages = {}
  for (const key of Object.keys(entries).sort()) {
    if (key === "" || key === own) continue
    const entry = entries[key]
    if (!isPlainObject(entry)) throw new Error(`the installed npm lock entry ${key} is not an object`)
    // A runtime entry that resolves to a local path is not reproducible evidence:
    // it points at a machine-specific checkout, not at a published input.
    if (typeof entry.resolved === "string" && LOCAL_PATH_PATTERN.test(entry.resolved)) {
      throw new Error("the installed npm lock resolves a runtime dependency from a local path")
    }
    packages[key] = entry
  }
  if (Object.keys(packages).length === 0) {
    throw new Error("the installed npm lock has no external runtime dependencies")
  }
  const lockfileVersion = lock.lockfileVersion
  if (!Number.isInteger(lockfileVersion)) throw new Error("the installed npm lock has no numeric lockfileVersion")
  return { lockfileVersion, packages }
}

function publicReason(error, workspace) {
  const message = String(error?.message ?? error ?? "unknown evidence failure")
  const text = workspace ? message.split(workspace).join("<e2e>") : message
  return text.replaceAll("\\", "/").slice(0, 400)
}

/**
 * The `deliveryInputs` object of a real E2E report.
 *
 * `complete: true` only when the installed package could be found unambiguously,
 * its Runtime Identity/Core provenance match the candidate checkout, and its
 * real ancestor lock was normalised without any local-path evidence. Every other
 * outcome is `complete: false` with a public reason: the caller still reports the
 * run's real result, it just cannot be reused as a baseline.
 */
export function collectDeliveryInputs({
  roots,
  workspace,
  packageName = CANDIDATE_PACKAGE_NAME,
  candidateSha,
  expectedIdentity,
  expectedProvenance,
} = {}) {
  try {
    const candidates = locateInstalledCandidates({ roots, workspace })
    if (candidates.length === 0) {
      return { complete: false, reason: "no installed candidate package with a Runtime Identity was found below the run directories" }
    }
    if (candidates.length > 1) {
      return { complete: false, reason: `exactly one installed candidate is required, found ${candidates.length}` }
    }
    const [located] = candidates
    const installed = readInstalledPackage({ root: located.root, packageName })
    if (expectedIdentity && !isDeepStrictEqual(installed.identity, expectedIdentity)) {
      throw new Error("the installed Runtime Identity does not match the candidate checkout")
    }
    if (expectedProvenance && !isDeepStrictEqual(installed.provenance, expectedProvenance)) {
      throw new Error("the installed Core provenance does not match the candidate checkout")
    }
    const lockLocation = findAncestorLock({ root: located.root, workspace })
    if (!lockLocation) throw new Error("the installed candidate has no ancestor npm lock")
    const lock = readJsonFile(lockLocation.lockPath, "the installed candidate npm lock")
    const normalized = normalizeInstalledLock({ lock, packageName, candidateSha })
    return { complete: true, ...normalized }
  } catch (error) {
    return { complete: false, reason: publicReason(error, workspace) }
  }
}
