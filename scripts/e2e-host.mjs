#!/usr/bin/env node
/**
 * Single-round real-host input resolution for the real-host E2E gates.
 *
 * The gate resolves the `latest` host exactly once per CI run, locks it in an
 * ordinary private npm project, and lets every isolated group job install the
 * very same manifest/lock into its own temporary prefix:
 *
 *   node scripts/e2e-host.mjs resolve --output <dir> --candidate <40-hex> --repository <owner/repo> [--host-package <name>] [--host-command <bin>]
 *   node scripts/e2e-host.mjs install --lock <dir> --prefix <dir> [--host-command <bin>]
 *
 * The OpenCode defaults are `@opencode/cli` + `opencode`. The same helper serves
 * the Pi gate through `--host-package @earendil-works/pi-coding-agent
 * --host-command pi` (and the same `hostPackage`/`hostCommand` options for direct
 * calls); `install` takes the host package from the locked manifest, so the two
 * sides cannot disagree. Every exported function keeps its OpenCode default
 * behaviour.
 *
 * `resolve` runs exactly one `npm view @opencode/cli@latest version`, writes
 * `package.json`, installs the exact version locally (no `--global`) so npm
 * generates `package-lock.json`, verifies the installed command path and its
 * reported version, and records the real inputs (candidate commit, host
 * version, Node/npm, OS/arch, runner image) in `host-input.json`.
 *
 * `install` copies that manifest/lock into a fresh prefix, runs `npm ci`, and
 * verifies the same command path and version. Nothing here pretends that two
 * npm ci runs produce byte-identical directories: only the locked inputs are
 * shared, and the real host installer still installs the candidate plugin.
 *
 * Every external command goes through an injectable executor so unit tests can
 * assert the exact command lines without touching the network.
 */
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const HOST_PACKAGE = "@opencode/cli"
export const HOST_COMMAND = "opencode"
export const HOST_LOCK_FILES = ["package.json", "package-lock.json"]
export const CANDIDATE_SHA_PATTERN = /^[0-9a-f]{40}$/u
export const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+$/u

/** The OpenCode launcher selects CPU-specific binaries at install time.
 * Observe the executable actually selected on PATH, including symlink targets;
 * identical package versions/locks alone cannot establish that selection.
 */
export function hostExecutableDigest(command, env = process.env) {
  try {
    const directories = String(env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean)
    for (const directory of directories) {
      const file = path.join(directory, command)
      if (existsSync(file)) return `sha256:${createHash("sha256").update(readFileSync(realpathSync(file))).digest("hex")}`
    }
  } catch {
    // Missing evidence closes reuse, not an otherwise successful full E2E.
  }
  return null
}

/** Reject anything that is not an exact stable semver (`latest` never suffices). */
export function parseExactVersion(raw) {
  const value = String(raw ?? "").trim()
  if (!EXACT_VERSION_PATTERN.test(value)) {
    throw new Error(`expected an exact stable version such as 2.0.16, got ${JSON.stringify(raw)}`)
  }
  return value
}

/**
 * Build the immutable `github:<owner>/<repo>#<sha>` package spec. Mutable
 * branches and short SHAs are rejected outright.
 */
export function candidatePackageSpec({ repository, sha }) {
  if (!/^[\w.-]+\/[\w.-]+$/u.test(String(repository ?? ""))) {
    throw new Error(`repository must be owner/name, got ${JSON.stringify(repository)}`)
  }
  if (!CANDIDATE_SHA_PATTERN.test(String(sha ?? ""))) {
    throw new Error(`candidate must be a full 40-character lowercase Git commit SHA, got ${JSON.stringify(sha)}`)
  }
  return `github:${repository}#${sha}`
}

/** The private, throw-away npm project that holds the host dependency lock. */
export function hostManifest(version, { hostPackage = HOST_PACKAGE, hostCommand = HOST_COMMAND } = {}) {
  if (!/^(?:@[\w.-]+\/)?[\w.-]+$/u.test(String(hostPackage ?? ""))) {
    throw new Error(`host package must be an npm package name, got ${JSON.stringify(hostPackage)}`)
  }
  if (!/^[\w.-]+$/u.test(String(hostCommand ?? ""))) {
    throw new Error(`host command must be a plain command name, got ${JSON.stringify(hostCommand)}`)
  }
  return {
    name: `${hostCommand}-e2e-host`,
    private: true,
    version: "0.0.0",
    dependencies: { [hostPackage]: parseExactVersion(version) },
  }
}

/** Real host command path inside a prefix (Windows npm creates `.cmd` shims). */
export function hostBinPath(prefix, platform = process.platform, hostCommand = HOST_COMMAND) {
  const target = path.join(prefix, "node_modules", ".bin", hostCommand)
  return platform === "win32" ? `${target}.cmd` : target
}

/** The single host dependency of a lock/manifest produced by this helper. */
export function lockedHostPackage(manifest, { hostPackage } = {}) {
  const names = Object.keys(manifest?.dependencies ?? {})
  if (hostPackage) {
    if (!names.includes(hostPackage)) {
      throw new Error(`the locked host manifest does not declare ${hostPackage}`)
    }
    return hostPackage
  }
  if (names.length !== 1) {
    throw new Error(`the locked host manifest must declare exactly one dependency, found ${JSON.stringify(names)}`)
  }
  return names[0]
}

/**
 * Record the inputs a later run would have to reproduce before its behaviour
 * results could be reused. Values are read from the environment; nothing
 * sensitive is captured.
 */
export function environmentRecord({ version, hostPackage = HOST_PACKAGE, env = process.env, platform = process.platform, arch = process.arch, nodeVersion = process.version, npmVersion, candidateSha = null }) {
  return {
    hostPackage,
    hostVersion: parseExactVersion(version),
    candidateSha,
    node: nodeVersion,
    npm: npmVersion ?? null,
    os: { platform, arch, release: os.release() },
    runner: {
      ImageOS: env.ImageOS ?? null,
      ImageVersion: env.ImageVersion ?? null,
    },
    resolvedAt: new Date().toISOString(),
  }
}

function requireSuccess(result, what) {
  if (!result || result.status !== 0) {
    const stderr = String(result?.stderr ?? "").trim()
    const detail = stderr ? `: ${stderr}` : ""
    throw new Error(`${what} failed with exit code ${result?.status}${detail}`)
  }
  return result
}

function lockVersion(lock, version, hostPackage = HOST_PACKAGE) {
  const entry = lock?.packages?.[`node_modules/${hostPackage}`]
  if (entry?.version !== version) {
    throw new Error(`package-lock.json does not lock ${hostPackage}@${version} (found ${JSON.stringify(entry?.version)})`)
  }
  return entry.version
}

function reportedVersion(stdout) {
  const match = String(stdout ?? "").match(/(\d+\.\d+\.\d+)/u)
  if (!match) throw new Error(`host command did not report a version, got ${JSON.stringify(String(stdout ?? "").trim())}`)
  return match[1]
}

/**
 * Verify that a prefix really contains the locked host command and that it
 * reports the expected version. The command path itself is checked, so a
 * pre-installed global host on PATH cannot satisfy this.
 */
export async function verifyHostInstall({ prefix, expectedVersion, run, env = process.env, platform = process.platform, hostCommand = HOST_COMMAND }) {
  const binPath = hostBinPath(prefix, platform, hostCommand)
  if (!existsSync(binPath)) {
    throw new Error(`host command was not installed at ${binPath}`)
  }
  const result = requireSuccess(
    await run({ command: binPath, args: ["--version"], env, shell: platform === "win32" }),
    `${binPath} --version`,
  )
  const version = reportedVersion(result.stdout)
  if (version !== expectedVersion) {
    throw new Error(`host version mismatch: ${binPath} reports ${version}, expected ${expectedVersion}`)
  }
  return { binPath, binDir: path.dirname(binPath), version }
}

/**
 * Resolve `latest` once and materialise a reusable private lock.
 *
 * `run` must be `({ command, args, env, shell }) => Promise<{status, stdout, stderr}>`.
 */
export async function resolveHost({ outputDir, run, env = process.env, repository, candidateSha, platform = process.platform, nodeVersion = process.version, hostPackage = HOST_PACKAGE, hostCommand = HOST_COMMAND }) {
  if (!outputDir) throw new Error("resolveHost requires an output directory")
  if (typeof run !== "function") throw new Error("resolveHost requires a command executor")
  const packageSpec = candidatePackageSpec({ repository, sha: candidateSha })
  mkdirSync(outputDir, { recursive: true })

  // Exactly one network resolution of the moving input.
  const view = requireSuccess(
    await run({ command: "npm", args: ["view", `${hostPackage}@latest`, "version"], env }),
    "npm view",
  )
  const version = parseExactVersion(view.stdout)
  const npmVersion = requireSuccess(await run({ command: "npm", args: ["--version"], env }), "npm --version").stdout.trim()

  const manifestPath = path.join(outputDir, "package.json")
  writeFileSync(manifestPath, `${JSON.stringify(hostManifest(version, { hostPackage, hostCommand }), null, 2)}\n`)

  requireSuccess(
    await run({
      command: "npm",
      args: ["install", "--prefix", outputDir, "--save-exact", `${hostPackage}@${version}`, "--no-audit", "--no-fund"],
      env,
    }),
    "npm install",
  )

  const lockPath = path.join(outputDir, "package-lock.json")
  if (!existsSync(lockPath)) throw new Error(`npm install did not produce ${lockPath}`)
  const locked = lockVersion(JSON.parse(readFileSync(lockPath, "utf8")), version, hostPackage)
  const installed = await verifyHostInstall({ prefix: outputDir, expectedVersion: locked, run, env, platform, hostCommand })

  const record = {
    ...environmentRecord({ version, hostPackage, env, platform, nodeVersion, npmVersion, candidateSha }),
    packageSpec,
    hostBin: installed.binPath,
    hostLock: HOST_LOCK_FILES,
  }
  const recordPath = path.join(outputDir, "host-input.json")
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`)
  return { version, hostPackage, hostCommand, packageSpec, outputDir, lockPath, manifestPath, recordPath, record, installed }
}

/**
 * Install the already-resolved lock into an independent prefix.
 *
 * `lockDir` holds the uploaded `package.json` + `package-lock.json`; `prefix`
 * is a fresh directory for this job only.
 */
export async function installHost({ lockDir, prefix, run, env = process.env, platform = process.platform, hostPackage, hostCommand = HOST_COMMAND }) {
  if (!lockDir || !prefix) throw new Error("installHost requires both --lock and --prefix")
  if (typeof run !== "function") throw new Error("installHost requires a command executor")
  const manifestPath = path.join(lockDir, "package.json")
  const lockPath = path.join(lockDir, "package-lock.json")
  for (const file of [manifestPath, lockPath]) {
    if (!existsSync(file)) throw new Error(`locked host input is missing ${file}`)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  const lockedPackage = lockedHostPackage(manifest, { hostPackage })
  const version = parseExactVersion(manifest?.dependencies?.[lockedPackage])
  lockVersion(JSON.parse(readFileSync(lockPath, "utf8")), version, lockedPackage)

  mkdirSync(prefix, { recursive: true })
  for (const file of HOST_LOCK_FILES) copyFileSync(path.join(lockDir, file), path.join(prefix, file))

  requireSuccess(
    await run({ command: "npm", args: ["ci", "--prefix", prefix, "--no-audit", "--no-fund"], env }),
    "npm ci",
  )
  const installed = await verifyHostInstall({ prefix, expectedVersion: version, run, env, platform, hostCommand })
  return { version, hostPackage: lockedPackage, hostCommand, prefix, ...installed }
}

/** Default executor: real processes, no shell unless a Windows `.cmd` shim needs one. */
export function spawnExecutor({ spawn = spawnSync } = {}) {
  return async ({ command, args, env, shell = false }) => {
    const result = spawn(command, args, { encoding: "utf8", env, shell, stdio: ["ignore", "pipe", "pipe"] })
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
  }
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = {}
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]
    const value = rest[index + 1]
    if (!key?.startsWith("--") || value === undefined) throw new Error(`invalid argument ${JSON.stringify(key)}`)
    options[key.slice(2)] = value
  }
  return { command, options }
}

async function main(argv) {
  const { command, options } = parseArgs(argv)
  const run = spawnExecutor()
  const hostPackage = options["host-package"] ?? HOST_PACKAGE
  const hostCommand = options["host-command"] ?? HOST_COMMAND
  if (command === "resolve") {
    const result = await resolveHost({
      outputDir: options.output,
      run,
      repository: options.repository ?? process.env.GITHUB_REPOSITORY,
      candidateSha: options.candidate ?? process.env.E2E_CANDIDATE_SHA,
      hostPackage,
      hostCommand,
    })
    console.log(`resolved ${result.hostPackage}@${result.version} -> ${result.outputDir}`)
    console.log(JSON.stringify(result.record, null, 2))
    return
  }
  if (command === "install") {
    const result = await installHost({ lockDir: options.lock, prefix: options.prefix, run, hostPackage: options["host-package"], hostCommand })
    console.log(`installed ${result.hostPackage}@${result.version} at ${result.binPath}`)
    return
  }
  throw new Error(`unknown command ${JSON.stringify(command)}; expected resolve or install`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`e2e-host: ${error.message}`)
    process.exit(1)
  })
}
