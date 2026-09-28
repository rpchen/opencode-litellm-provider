import { execFileSync } from "node:child_process"
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync,
  rmSync, writeFileSync,
} from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const CORE_REPOSITORY = "https://github.com/rpchen/litellm-discovery-core.git"
export const CORE_BRANCH = "main"
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
export const GENERATED_PATH = "src/generated/discovery-core"
export const PROVENANCE_PATH = "dist/core-provenance.json"

/** Validate before using a value in a command, cache path, or generated output. */
export function validateSHA(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/iu.test(value)) {
    throw new Error("core SHA must be a complete 40-character hexadecimal commit ID")
  }
  return value.toLowerCase()
}

export function provenanceFor(sha) {
  return { repository: CORE_REPOSITORY, branch: CORE_BRANCH, sha: validateSHA(sha) }
}

export function readProvenance(root = ROOT) {
  let value
  try {
    const file = path.join(root, PROVENANCE_PATH)
    if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error("Unsafe provenance")
    value = JSON.parse(readFileSync(file, "utf8"))
  } catch {
    throw new Error("Missing or unreadable core provenance; run build:dist explicitly to update")
  }
  if (!value || typeof value !== "object" || Array.isArray(value)
      || value.repository !== CORE_REPOSITORY || value.branch !== CORE_BRANCH) {
    throw new Error("Invalid core provenance repository or branch")
  }
  return provenanceFor(value.sha)
}

/** Do not forward Git stderr: it may contain credentials or absolute cache paths. */
export function git(args, cwd) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" }
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE"]) delete env[key]
  try {
    return execFileSync("git", ["--no-replace-objects", "-c", "credential.helper=", "-c", "core.fsmonitor=false", ...args], {
      cwd, env, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024,
    })
  } catch {
    throw new Error(`core Git ${args[0]} failed; check public repository access and the selected SHA`)
  }
}

export function resolveMainSHA() {
  const text = git(["ls-remote", "--exit-code", CORE_REPOSITORY, `refs/heads/${CORE_BRANCH}`])
    .toString("utf8").trim()
  const lines = text.split("\n")
  const [sha, ref] = lines[0]?.split(/\s+/u) ?? []
  if (lines.length !== 1 || ref !== `refs/heads/${CORE_BRANCH}`) {
    throw new Error("Cannot resolve a unique core/main commit")
  }
  return validateSHA(sha)
}

export function selectCore({ root = ROOT, mode = "provenance", sha, resolveMain = resolveMainSHA } = {}) {
  if (mode === "sha") return provenanceFor(sha)
  if (sha !== undefined) throw new Error("An explicit core SHA requires SHA selection mode")
  if (mode === "provenance") return readProvenance(root)
  if (mode === "update") return provenanceFor(resolveMain())
  throw new Error("Unknown core selection mode")
}

export function parseSelectionArgs(args, defaultMode = "provenance") {
  if (args.length === 0) return { mode: defaultMode }
  if (args.length !== 1) throw new Error("Choose exactly one of --update, --from-provenance, or --sha=<commit>")
  if (args[0] === "--update") return { mode: "update" }
  if (args[0] === "--from-provenance") return { mode: "provenance" }
  if (args[0].startsWith("--sha=")) return { mode: "sha", sha: validateSHA(args[0].slice(6)) }
  throw new Error("Unknown core selection argument")
}

export function assertCleanCheckout(cache) {
  const status = git(["status", "--porcelain=v1", "--untracked-files=all"], cache).toString("utf8")
  if (status) throw new Error("Dirty core cache rejected (staged, unstaged, or untracked changes); preserve or remove it explicitly")
}

export function assertCommit(cache, selectedSHA) {
  const sha = validateSHA(selectedSHA)
  const actual = git(["rev-parse", "--verify", "HEAD^{commit}"], cache).toString("utf8").trim()
  if (actual !== sha) throw new Error("Core cache HEAD does not match the selected commit")
  const object = git(["rev-parse", "--verify", `${sha}^{commit}`], cache).toString("utf8").trim()
  if (object !== sha) throw new Error("Selected core object is not the expected commit")
}

/** Export committed blobs, never the checkout's file contents (including after the cleanliness check). */
export function exportCore(cache, selectedSHA, destination) {
  const sha = validateSHA(selectedSHA)
  assertCleanCheckout(cache)
  assertCommit(cache, sha)
  const tree = git(["ls-tree", "-r", "-z", "--full-tree", sha, "--", "src", "LICENSE"], cache)
    .toString("utf8").split("\0").filter(Boolean)
  const entries = tree.map((entry) => {
    const tab = entry.indexOf("\t")
    const [mode, type, oid] = entry.slice(0, tab).split(" ")
    const source = entry.slice(tab + 1)
    if (tab < 0 || type !== "blob" || !["100644", "100755"].includes(mode)) {
      throw new Error("Core source must contain regular Git blobs, not symlinks or submodules")
    }
    const relative = source === "LICENSE" ? source : source.startsWith("src/") ? source.slice(4) : ""
    if (!relative || relative.includes("\\") || relative.split("/").some((part) => !part || part === "." || part === "..")
        || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative)) {
      throw new Error("Unsafe core source path rejected")
    }
    return { relative, oid: validateSHA(oid) }
  })
  if (!entries.some((entry) => entry.relative === "index.ts") || !entries.some((entry) => entry.relative === "LICENSE")) {
    throw new Error("Core commit must provide src/index.ts and LICENSE")
  }
  // Complete all Git reads before replacing any existing generated directory.
  if (new Set(entries.map((entry) => entry.relative)).size !== entries.length) {
    throw new Error("Duplicate core source output paths rejected")
  }
  const files = entries.map((entry) => ({ ...entry, bytes: git(["cat-file", "blob", entry.oid], cache) }))
  mkdirSync(path.dirname(destination), { recursive: true })
  const temporary = mkdtempSync(path.join(path.dirname(destination), ".core-export-"))
  try {
    for (const file of files) {
      const output = path.join(temporary, file.relative)
      mkdirSync(path.dirname(output), { recursive: true })
      writeFileSync(output, file.bytes)
    }
    rmSync(destination, { recursive: true, force: true })
    renameSync(temporary, destination)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

/** Compatibility imports for existing OpenCode callers and tests; no business implementation. */
export function writeLegacyFacades(root = ROOT) {
  const directory = path.join(root, "src", "core")
  rmSync(directory, { recursive: true, force: true })
  mkdirSync(directory, { recursive: true })
  const header = "// Generated by scripts/prepare-core.mjs; do not edit or commit.\n"
  for (const name of ["capabilities", "diagnostics", "litellm", "modelsdev", "refresh", "snapshot"]) {
    writeFileSync(path.join(directory, `${name}.ts`),
      header + 'export * from "../generated/discovery-core/index.js"\n')
  }
  writeFileSync(path.join(directory, "protocol.ts"), header
    + 'export { deploymentProtocol, resolveProtocol } from "../generated/discovery-core/index.js"\n'
    + 'export type { Protocol } from "../generated/discovery-core/index.js"\n'
    + 'export { PROTOCOL_PACKAGES } from "../host/protocol.js"\n')
  writeFileSync(path.join(directory, "build.ts"), header + 'export * from "../host/models.js"\n')
}

/** Existing caches are never reset, cleaned, stashed, or overwritten on an error. */
export function prepareCore({ root = ROOT, selection = readProvenance(root), cacheRoot = path.join(ROOT, ".tmp", "discovery-core") } = {}) {
  const provenance = provenanceFor(selection.sha)
  if (selection.repository !== CORE_REPOSITORY || selection.branch !== CORE_BRANCH) {
    throw new Error("Unexpected core source repository or branch")
  }
  const cache = path.join(cacheRoot, provenance.sha)
  mkdirSync(cacheRoot, { recursive: true })
  const lock = `${cache}.lock`
  try {
    mkdirSync(lock)
  } catch {
    throw new Error("Core cache is locked; another preparation may be running")
  }
  try {
    if (existsSync(cache)) {
      if (!lstatSync(cache).isDirectory() || lstatSync(cache).isSymbolicLink() || !existsSync(path.join(cache, ".git"))) {
        throw new Error("Incomplete or unsafe core cache; preserve or remove it explicitly")
      }
      assertCleanCheckout(cache)
      assertCommit(cache, provenance.sha)
    } else {
      mkdirSync(cache)
      git(["init", "--quiet"], cache)
      git(["remote", "add", "origin", CORE_REPOSITORY], cache)
      git(["fetch", "--quiet", "--depth=1", "origin", provenance.sha], cache)
      git(["checkout", "--quiet", "--detach", provenance.sha], cache)
    }
    exportCore(cache, provenance.sha, path.join(root, GENERATED_PATH))
    writeLegacyFacades(root)
    mkdirSync(path.join(root, ".tmp"), { recursive: true })
    writeFileSync(path.join(root, ".tmp", "core-selection.json"), JSON.stringify(provenance, null, 2) + "\n")
    return provenance
  } finally {
    rmSync(lock, { recursive: true, force: true })
  }
}

export function isMain(url) {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(url)
}

export async function main(action) {
  try {
    await action()
  } catch (error) {
    // Our Git/provenance errors intentionally omit credentials and machine paths.
    const systemError = error instanceof Error && ("path" in error || "syscall" in error)
    console.error(systemError ? "Core filesystem operation failed; check workspace access"
      : error instanceof Error ? error.message : "Core operation failed")
    process.exitCode = 1
  }
}

if (isMain(import.meta.url)) {
  await main(() => {
    const selection = selectCore({ ...parseSelectionArgs(process.argv.slice(2)), root: ROOT })
    const result = prepareCore({ selection })
    console.log(JSON.stringify(result))
  })
}
