import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { GENERATED_PATH, ROOT, prepareCore, provenanceFor, readProvenance } from "./prepare-core.mjs"

export const RUNTIME_IDENTITY_FILE = "runtime-identity.json"

function toPosixPath(value) {
  return value.replaceAll("\\", "/")
}

/** Canonical digest inputs: every regular dist file except the identity file itself. */
export function listDigestInputs(dist) {
  const inputs = []
  const walk = (absolute, prefix = "") => {
    if (!existsSync(absolute) || !lstatSync(absolute).isDirectory() || lstatSync(absolute).isSymbolicLink()) {
      throw new Error("Distribution directory is missing or unsafe")
    }
    for (const name of readdirSync(absolute).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name
      const entry = path.join(absolute, name)
      const stat = lstatSync(entry)
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        throw new Error(`Non-regular distribution entry: ${relative}`)
      }
      if (stat.isDirectory()) walk(entry, relative)
      else if (toPosixPath(relative) !== RUNTIME_IDENTITY_FILE) inputs.push(toPosixPath(relative))
    }
  }
  walk(dist)
  return inputs.sort()
}

export function computeArtifactDigest(dist) {
  const manifest = listDigestInputs(dist)
    .map((relative) => {
      const bytes = readFileSync(path.join(dist, ...relative.split("/")))
      return `${createHash("sha256").update(bytes).digest("hex")}  ${relative}\n`
    })
    .join("")
  return `sha256:${createHash("sha256").update(manifest, "utf8").digest("hex")}`
}

export function readPackageVersion(root = ROOT) {
  let value
  try {
    value = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
  } catch {
    throw new Error("Runtime identity requires a readable package.json version")
  }
  if (!value || typeof value.version !== "string" || value.version.length === 0) {
    throw new Error("Runtime identity requires a non-empty package.json version")
  }
  return value.version
}

export function writeRuntimeIdentity(out, { pluginVersion, coreCommit }) {
  if (typeof pluginVersion !== "string" || pluginVersion.length === 0) {
    throw new Error("Runtime identity pluginVersion is missing")
  }
  if (typeof coreCommit !== "string" || !/^[0-9a-f]{40}$/u.test(coreCommit)) {
    throw new Error("Runtime identity coreCommit must be a complete 40-character hexadecimal commit ID")
  }
  const artifactDigest = computeArtifactDigest(out)
  const identity = { pluginVersion, artifactDigest, coreCommit }
  writeFileSync(path.join(out, RUNTIME_IDENTITY_FILE), `${JSON.stringify(identity, null, 2)}\n`)
  return identity
}

export function readRuntimeIdentity(dist) {
  let value
  try {
    const file = path.join(dist, RUNTIME_IDENTITY_FILE)
    if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error("Unsafe identity")
    value = JSON.parse(readFileSync(file, "utf8"))
  } catch {
    throw new Error("Missing or unreadable runtime identity; rebuild dist to generate it")
  }
  if (!value || typeof value !== "object" || Array.isArray(value)
      || typeof value.pluginVersion !== "string" || value.pluginVersion.length === 0
      || typeof value.artifactDigest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value.artifactDigest)
      || typeof value.coreCommit !== "string" || !/^[0-9a-f]{40}$/u.test(value.coreCommit)) {
    throw new Error("Invalid runtime identity fields")
  }
  return value
}

/** Formal verification: identity ↔ package version ↔ provenance SHA ↔ dist bytes. [VERIFY-STRICT] */
export function verifyRuntimeIdentity({ root = ROOT, dist: distArg, selection } = {}) {
  const dist = distArg ?? path.join(root, "dist")
  const identity = readRuntimeIdentity(dist)
  const expectedVersion = readPackageVersion(root)
  if (identity.pluginVersion !== expectedVersion) {
    throw new Error("Runtime identity pluginVersion does not match package.json")
  }
  const expectedCore = selection?.sha ?? readProvenance(root).sha
  if (identity.coreCommit !== expectedCore) {
    throw new Error("Runtime identity coreCommit does not match core provenance")
  }
  const expectedDigest = computeArtifactDigest(dist)
  if (identity.artifactDigest !== expectedDigest) {
    throw new Error("Runtime identity artifactDigest does not match distribution bytes")
  }
  return identity
}

export function run(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" })
  if (result.error) throw new Error("Required build executable could not be started")
  if (result.status !== 0) throw new Error(`Build command failed with exit status ${result.status ?? "signal"}`)
}

export function typecheck(root = ROOT, toolRoot = ROOT) {
  run(process.execPath, [path.join(toolRoot, "node_modules", "typescript", "bin", "tsc"), "--noEmit"], root)
}

export function unitTest(root = ROOT) {
  run("bun", ["test"], root)
}

export function compileDistribution(root, out, selection, toolRoot = ROOT) {
  mkdirSync(out, { recursive: true })
  run(process.execPath, [path.join(toolRoot, "node_modules", "typescript", "bin", "tsc"),
    "-p", path.join(root, "tsconfig.build.json"), "--outDir", out], root)
  writeFileSync(path.join(out, "core-provenance.json"), JSON.stringify(provenanceFor(selection.sha), null, 2) + "\n")
  const license = path.join(out, "generated", "discovery-core", "LICENSE")
  mkdirSync(path.dirname(license), { recursive: true })
  cpSync(path.join(root, GENERATED_PATH, "LICENSE"), license)
  writeRuntimeIdentity(out, { pluginVersion: readPackageVersion(root), coreCommit: selection.sha })
}

export function directoryEntries(root, prefix = "") {
  if (!existsSync(root) || !lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) {
    throw new Error("Distribution directory is missing or unsafe")
  }
  const entries = []
  for (const name of readdirSync(root).sort()) {
    const relative = prefix ? `${prefix}/${name}` : name
    const absolute = path.join(root, name)
    const stat = lstatSync(absolute)
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      throw new Error(`Non-regular distribution entry: ${relative}`)
    }
    if (stat.isDirectory()) {
      entries.push(`${relative}/`, ...directoryEntries(absolute, relative))
    } else entries.push(relative)
  }
  return entries
}

export function compareDistributions(candidate, rebuilt) {
  const left = directoryEntries(candidate)
  const right = directoryEntries(rebuilt)
  const missing = right.filter((entry) => !left.includes(entry))
  const extra = left.filter((entry) => !right.includes(entry))
  const changed = left.filter((entry) => !entry.endsWith("/") && right.includes(entry)
    && !readFileSync(path.join(candidate, entry)).equals(readFileSync(path.join(rebuilt, entry))))
  if (missing.length || extra.length || changed.length) {
    throw new Error(`Committed dist mismatch: ${JSON.stringify({ missing, extra, changed })}`)
  }
  return left.filter((entry) => !entry.endsWith("/")).length
}

/** Copy only build inputs. Never copy candidate dist or generated core into the rebuild. */
export function isolatedBuildRoot(root, includeTests = false) {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "opencode-core-verify-"))
  try {
    cpSync(path.join(root, "src"), path.join(temporary, "src"), {
      recursive: true,
      filter: (source) => source !== path.join(root, "src", "generated")
        && source !== path.join(root, "src", "core"),
    })
    for (const name of ["package.json", "tsconfig.json", "tsconfig.build.json"]) {
      cpSync(path.join(root, name), path.join(temporary, name))
    }
    if (includeTests) cpSync(path.join(root, "test"), path.join(temporary, "test"), { recursive: true })
    // Compiler/host declarations only; this link is not copied to dist or the package.
    symlinkSync(path.join(root, "node_modules"), path.join(temporary, "node_modules"), "junction")
    return temporary
  } catch {
    rmSync(temporary, { recursive: true, force: true })
    throw new Error("Cannot create isolated build inputs")
  }
}

export function verifyDistribution({ root = ROOT, cacheRoot, prepare = prepareCore, compile = compileDistribution } = {}) {
  // Read and validate before creating temp inputs or doing any Git/network operation.
  const selection = readProvenance(root)
  const candidate = path.join(root, "dist")
  directoryEntries(candidate)
  verifyRuntimeIdentity({ root, dist: candidate, selection })
  const temporary = isolatedBuildRoot(root)
  try {
    prepare({ root: temporary, selection, ...(cacheRoot ? { cacheRoot } : {}) })
    const rebuilt = path.join(temporary, "dist")
    compile(temporary, rebuilt, selection, root)
    verifyRuntimeIdentity({ root: temporary, dist: rebuilt, selection })
    return { sha: selection.sha, files: compareDistributions(candidate, rebuilt) }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}
