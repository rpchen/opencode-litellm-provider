import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import {
  candidatePackageSpec,
  environmentRecord,
  HOST_COMMAND,
  HOST_PACKAGE,
  hostBinPath,
  hostExecutableDigest,
  hostManifest,
  installHost,
  parseExactVersion,
  resolveHost,
  verifyHostInstall,
} from "./e2e-host.mjs"

const SHA = "abcdef0123456789abcdef0123456789abcdef01"
const REPOSITORY = "rpchen/opencode-litellm-provider"

test("host executable evidence follows PATH and detects actual binary changes", () => {
  const first = mkdtempSync(path.join(os.tmpdir(), "host-binary-first-"))
  const second = mkdtempSync(path.join(os.tmpdir(), "host-binary-second-"))
  const name = "test-host"
  writeFileSync(path.join(first, name), "binary-one")
  writeFileSync(path.join(second, name), "binary-two")
  const digest = hostExecutableDigest(name, { PATH: [first, second].join(path.delimiter) })
  assert.match(digest, /^sha256:[a-f0-9]{64}$/u)
  assert.notEqual(digest, hostExecutableDigest(name, { PATH: second }))
  writeFileSync(path.join(first, name), "binary-three")
  assert.notEqual(digest, hostExecutableDigest(name, { PATH: first }))
  assert.equal(hostExecutableDigest("missing", { PATH: first }), null)
})

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), "e2e-host-test-"))
}

/** Build a fake executor that also materialises the files a real npm would write. */
function fakeExecutor({ version = "2.0.16", stdoutForVersion, installFails = false, ciFails = false } = {}) {
  const calls = []
  const run = async ({ command, args }) => {
    calls.push([command, ...args])
    if (command === "npm" && args[0] === "view") return { status: 0, stdout: `${version}\n`, stderr: "" }
    if (command === "npm" && args[0] === "--version") return { status: 0, stdout: "10.9.4\n", stderr: "" }
    if (command === "npm" && args[0] === "install") {
      if (installFails) return { status: 1, stdout: "", stderr: "E404 not found" }
      const prefix = args[args.indexOf("--prefix") + 1]
      writeFileSync(
        path.join(prefix, "package-lock.json"),
        JSON.stringify({ lockfileVersion: 3, packages: { [`node_modules/${HOST_PACKAGE}`]: { version } } }),
      )
      const bin = hostBinPath(prefix, "linux")
      mkdirSync(path.dirname(bin), { recursive: true })
      writeFileSync(bin, "#!/bin/sh\n")
      return { status: 0, stdout: "added 1 package", stderr: "" }
    }
    if (command === "npm" && args[0] === "ci") {
      if (ciFails) return { status: 1, stdout: "", stderr: "lock file out of sync" }
      const prefix = args[args.indexOf("--prefix") + 1]
      const bin = hostBinPath(prefix, "linux")
      mkdirSync(path.dirname(bin), { recursive: true })
      writeFileSync(bin, "#!/bin/sh\n")
      return { status: 0, stdout: "added 1 package", stderr: "" }
    }
    if (String(command).split(/[\\/]/u).includes("opencode")) {
      return { status: 0, stdout: stdoutForVersion ?? `${version}\n`, stderr: "" }
    }
    return { status: 1, stdout: "", stderr: `unexpected command ${command} ${args.join(" ")}` }
  }
  return { run, calls }
}

test("parseExactVersion accepts only exact stable versions", () => {
  assert.equal(parseExactVersion("2.0.16\n"), "2.0.16")
  for (const bad of ["latest", "2.0", "^2.0.16", "2.0.16-beta.1", "", undefined]) {
    assert.throws(() => parseExactVersion(bad), /exact stable version/u)
  }
})

test("candidatePackageSpec refuses mutable refs and short SHAs", () => {
  assert.equal(candidatePackageSpec({ repository: REPOSITORY, sha: SHA }), `github:${REPOSITORY}#${SHA}`)
  assert.throws(() => candidatePackageSpec({ repository: REPOSITORY, sha: "main" }), /40-character/u)
  assert.throws(() => candidatePackageSpec({ repository: REPOSITORY, sha: SHA.slice(0, 12) }), /40-character/u)
  assert.throws(() => candidatePackageSpec({ repository: REPOSITORY, sha: SHA.toUpperCase() }), /40-character/u)
  assert.throws(() => candidatePackageSpec({ repository: "not-a-repo", sha: SHA }), /owner\/name/u)
})

test("hostManifest is a private project pinned to the exact version", () => {
  assert.deepEqual(hostManifest("2.0.16"), {
    name: "opencode-e2e-host",
    private: true,
    version: "0.0.0",
    dependencies: { [HOST_PACKAGE]: "2.0.16" },
  })
})

test("environmentRecord captures the reproducible inputs without secrets", () => {
  const record = environmentRecord({
    version: "2.0.16",
    env: { ImageOS: "ubuntu24", ImageVersion: "20250101.1.0", LITELLM_API_KEY: "sk-xxx" },
    platform: "linux",
    arch: "x64",
    nodeVersion: "v22.23.4",
    npmVersion: "10.9.4",
    candidateSha: SHA,
  })
  assert.equal(record.hostVersion, "2.0.16")
  assert.equal(record.node, "v22.23.4")
  assert.equal(record.npm, "10.9.4")
  assert.deepEqual(record.os.platform, "linux")
  assert.deepEqual(record.runner, { ImageOS: "ubuntu24", ImageVersion: "20250101.1.0" })
  assert.equal(record.candidateSha, SHA)
  assert.ok(!JSON.stringify(record).includes("sk-xxx"))
})

test("resolveHost locks the exact version and records the host input", async () => {
  const outputDir = path.join(tempDir(), "host-lock")
  const { run, calls } = fakeExecutor()
  const result = await resolveHost({
    outputDir,
    run,
    env: { ImageOS: "ubuntu24", ImageVersion: "20250101.1.0" },
    repository: REPOSITORY,
    candidateSha: SHA,
    platform: "linux",
    nodeVersion: "v22.23.4",
  })

  assert.equal(result.version, "2.0.16")
  assert.equal(result.packageSpec, `github:${REPOSITORY}#${SHA}`)
  const views = calls.filter((call) => call[0] === "npm" && call[1] === "view")
  assert.equal(views.length, 1, "latest must be resolved exactly once")
  assert.deepEqual(views[0], ["npm", "view", `${HOST_PACKAGE}@latest`, "version"])
  const install = calls.find((call) => call[0] === "npm" && call[1] === "install")
  assert.ok(install, "install must run")
  assert.ok(install.includes("--save-exact"), "install must pin the resolved version")
  assert.ok(!install.includes("--global"), "the host must not be installed globally")
  assert.ok(install.includes(`${HOST_PACKAGE}@2.0.16`))

  const manifest = JSON.parse(readFileSync(path.join(outputDir, "package.json"), "utf8"))
  assert.deepEqual(manifest.dependencies, { [HOST_PACKAGE]: "2.0.16" })
  const record = JSON.parse(readFileSync(path.join(outputDir, "host-input.json"), "utf8"))
  assert.equal(record.hostVersion, "2.0.16")
  assert.equal(record.npm, "10.9.4")
  assert.equal(record.candidateSha, SHA)
  assert.equal(record.packageSpec, `github:${REPOSITORY}#${SHA}`)
})

test("resolveHost rejects a non-exact latest version", async () => {
  const { run } = fakeExecutor({ version: "2.0.16-next.3" })
  await assert.rejects(
    resolveHost({ outputDir: tempDir(), run, env: {}, repository: REPOSITORY, candidateSha: SHA, platform: "linux" }),
    /exact stable version/u,
  )
})

test("resolveHost propagates a failed install", async () => {
  const { run } = fakeExecutor({ installFails: true })
  await assert.rejects(
    resolveHost({ outputDir: tempDir(), run, env: {}, repository: REPOSITORY, candidateSha: SHA, platform: "linux" }),
    /npm install failed/u,
  )
})

test("resolveHost rejects a host binary that reports another version", async () => {
  const { run } = fakeExecutor({ stdoutForVersion: "2.0.15\n" })
  await assert.rejects(
    resolveHost({ outputDir: tempDir(), run, env: {}, repository: REPOSITORY, candidateSha: SHA, platform: "linux" }),
    /version mismatch/u,
  )
})

test("verifyHostInstall fails when the host command is missing from the prefix", async () => {
  const prefix = tempDir()
  const { run } = fakeExecutor()
  await assert.rejects(
    verifyHostInstall({ prefix, expectedVersion: "2.0.16", run, platform: "linux" }),
    /was not installed at/u,
  )
})

test("installHost installs the shared lock into an independent prefix", async () => {
  const lockDir = path.join(tempDir(), "host-lock")
  const { run: resolveRun } = fakeExecutor()
  await resolveHost({
    outputDir: lockDir,
    run: resolveRun,
    env: {},
    repository: REPOSITORY,
    candidateSha: SHA,
    platform: "linux",
  })

  const prefix = path.join(tempDir(), "host-prefix")
  const { run, calls } = fakeExecutor()
  const result = await installHost({ lockDir, prefix, run, env: {}, platform: "linux" })

  assert.equal(result.version, "2.0.16")
  assert.equal(path.dirname(result.binPath), path.join(prefix, "node_modules", ".bin"))
  const ci = calls.find((call) => call[0] === "npm" && call[1] === "ci")
  assert.deepEqual(ci, ["npm", "ci", "--prefix", prefix, "--no-audit", "--no-fund"])
  assert.ok(!calls.some((call) => call[1] === "install"), "installing the shared lock must not re-resolve")
  assert.equal(JSON.parse(readFileSync(path.join(prefix, "package-lock.json"), "utf8")).lockfileVersion, 3)
})

test("installHost fails closed on a missing lock or a broken npm ci", async () => {
  const emptyLock = tempDir()
  const { run } = fakeExecutor()
  await assert.rejects(
    installHost({ lockDir: emptyLock, prefix: tempDir(), run, env: {}, platform: "linux" }),
    /locked host input is missing/u,
  )

  const lockDir = path.join(tempDir(), "host-lock")
  await resolveHost({
    outputDir: lockDir,
    run: fakeExecutor().run,
    env: {},
    repository: REPOSITORY,
    candidateSha: SHA,
    platform: "linux",
  })
  const broken = fakeExecutor({ ciFails: true })
  await assert.rejects(
    installHost({ lockDir, prefix: path.join(tempDir(), "prefix"), run: broken.run, env: {}, platform: "linux" }),
    /npm ci failed/u,
  )
})

test("installHost rejects a lock whose manifest was edited after locking", async () => {
  const lockDir = path.join(tempDir(), "host-lock")
  await resolveHost({
    outputDir: lockDir,
    run: fakeExecutor().run,
    env: {},
    repository: REPOSITORY,
    candidateSha: SHA,
    platform: "linux",
  })
  writeFileSync(path.join(lockDir, "package.json"), JSON.stringify(hostManifest("9.9.9")))
  await assert.rejects(
    installHost({ lockDir, prefix: path.join(tempDir(), "prefix"), run: fakeExecutor().run, env: {}, platform: "linux" }),
    /does not lock/u,
  )
})

// The Pi gate reuses this helper with its own host package/command. Both are
// explicit options with the OpenCode values as defaults, so the two adapters
// never share a hard-coded host name.
const PI_PACKAGE = "@earendil-works/pi-coding-agent"
const PI_COMMAND = "pi"

function piExecutor({ version = "1.4.0", stdoutForVersion } = {}) {
  const calls = []
  const run = async ({ command, args }) => {
    calls.push([command, ...args])
    if (command === "npm" && args[0] === "view") return { status: 0, stdout: `${version}\n`, stderr: "" }
    if (command === "npm" && args[0] === "--version") return { status: 0, stdout: "10.9.4\n", stderr: "" }
    if (command === "npm" && args[0] === "install") {
      const prefix = args[args.indexOf("--prefix") + 1]
      writeFileSync(
        path.join(prefix, "package-lock.json"),
        JSON.stringify({ lockfileVersion: 3, packages: { [`node_modules/${PI_PACKAGE}`]: { version } } }),
      )
      const bin = hostBinPath(prefix, "linux", PI_COMMAND)
      mkdirSync(path.dirname(bin), { recursive: true })
      writeFileSync(bin, "#!/bin/sh\n")
      return { status: 0, stdout: "added 1 package", stderr: "" }
    }
    if (command === "npm" && args[0] === "ci") {
      const prefix = args[args.indexOf("--prefix") + 1]
      const bin = hostBinPath(prefix, "linux", PI_COMMAND)
      mkdirSync(path.dirname(bin), { recursive: true })
      writeFileSync(bin, "#!/bin/sh\n")
      return { status: 0, stdout: "added 1 package", stderr: "" }
    }
    if (String(command).split(/[\\/]/u).at(-1) === PI_COMMAND) {
      return { status: 0, stdout: stdoutForVersion ?? `${version}\n`, stderr: "" }
    }
    return { status: 1, stdout: "", stderr: `unexpected command ${command} ${args.join(" ")}` }
  }
  return { run, calls }
}

test("hostManifest and hostBinPath take the host package and command as options", () => {
  assert.deepEqual(hostManifest("1.4.0", { hostPackage: PI_PACKAGE, hostCommand: PI_COMMAND }), {
    name: "pi-e2e-host",
    private: true,
    version: "0.0.0",
    dependencies: { [PI_PACKAGE]: "1.4.0" },
  })
  assert.equal(hostBinPath("/tmp/prefix", "linux", PI_COMMAND), path.join("/tmp/prefix", "node_modules", ".bin", "pi"))
  assert.equal(hostBinPath("/tmp/prefix", "win32", PI_COMMAND), path.join("/tmp/prefix", "node_modules", ".bin", "pi.cmd"))
  // Defaults keep the OpenCode behaviour, including the historic project name.
  assert.equal(hostManifest("2.0.16").name, "opencode-e2e-host")
  assert.equal(hostBinPath("/tmp/prefix", "linux"), path.join("/tmp/prefix", "node_modules", ".bin", HOST_COMMAND))
  assert.throws(() => hostManifest("1.4.0", { hostPackage: "../escape" }), /npm package name/u)
})

test("resolveHost and installHost work for another host package/command", async () => {
  const outputDir = path.join(tempDir(), "pi-host-lock")
  const { run, calls } = piExecutor()
  const resolved = await resolveHost({
    outputDir,
    run,
    env: { ImageOS: "ubuntu24", ImageVersion: "20250101.1.0" },
    repository: REPOSITORY,
    candidateSha: SHA,
    platform: "linux",
    hostPackage: PI_PACKAGE,
    hostCommand: PI_COMMAND,
  })
  assert.equal(resolved.version, "1.4.0")
  assert.deepEqual(calls.find((call) => call[1] === "view"), ["npm", "view", `${PI_PACKAGE}@latest`, "version"])
  assert.ok(calls.find((call) => call[1] === "install").includes(`${PI_PACKAGE}@1.4.0`))
  assert.equal(resolved.record.hostPackage, PI_PACKAGE)
  assert.equal(resolved.installed.binPath, hostBinPath(outputDir, "linux", PI_COMMAND))

  const prefix = path.join(tempDir(), "pi-prefix")
  const installer = piExecutor()
  const installed = await installHost({ lockDir: outputDir, prefix, run: installer.run, env: {}, platform: "linux", hostCommand: PI_COMMAND })
  // The host package comes from the locked manifest, so install cannot drift.
  assert.equal(installed.hostPackage, PI_PACKAGE)
  assert.equal(installed.binPath, hostBinPath(prefix, "linux", PI_COMMAND))
  assert.ok(installer.calls.some((call) => call[1] === "ci"))
})

test("installHost refuses a lock that does not belong to the requested host package", async () => {
  const outputDir = path.join(tempDir(), "host-lock")
  await resolveHost({
    outputDir,
    run: fakeExecutor().run,
    env: {},
    repository: REPOSITORY,
    candidateSha: SHA,
    platform: "linux",
  })
  const { run } = piExecutor()
  await assert.rejects(
    installHost({ lockDir: outputDir, prefix: path.join(tempDir(), "prefix"), run, env: {}, platform: "linux", hostPackage: PI_PACKAGE }),
    /does not declare @earendil-works\/pi-coding-agent/u,
  )
})
