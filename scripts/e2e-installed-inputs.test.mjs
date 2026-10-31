import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import {
  CANDIDATE_PACKAGE_NAME,
  collectDeliveryInputs,
  findAncestorLock,
  locateInstalledCandidates,
  normalizeInstalledLock,
  readInstalledPackage,
} from "./e2e-installed-inputs.mjs"

const SHA = "abcdef0123456789abcdef0123456789abcdef01"
const IDENTITY = { pluginVersion: "0.11.2", artifactDigest: `sha256:${"a".repeat(64)}`, coreCommit: "1".repeat(40) }
const PROVENANCE = { repository: "https://github.com/rpchen/litellm-discovery-core.git", branch: "main", sha: IDENTITY.coreCommit }

function write(file, value) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value))
}

function tempWorkspace() {
  return mkdtempSync(path.join(os.tmpdir(), "e2e-installed-inputs-"))
}

/**
 * Build the layout the real installer leaves behind:
 *   <cache>/opencode/npm/<key>/<generation>/package.json
 *   <cache>/opencode/npm/<key>/<generation>/package-lock.json
 *   <cache>/opencode/npm/<key>/<generation>/node_modules/<pkg>/{package.json,dist/...}
 */
function installedTree({
  workspace,
  generation = "1",
  identity = IDENTITY,
  provenance = PROVENANCE,
  manifest = { name: CANDIDATE_PACKAGE_NAME, version: IDENTITY.pluginVersion },
  lock = defaultLock(),
  extraCandidate,
} = {}) {
  const root = path.join(workspace, "cache", "opencode", "npm", "git-opencode-litellm-provider-abc123", generation)
  const pkg = path.join(root, "node_modules", CANDIDATE_PACKAGE_NAME)
  write(path.join(root, "package.json"), { name: "staged", dependencies: { [CANDIDATE_PACKAGE_NAME]: `github:rpchen/opencode-litellm-provider#${SHA}` } })
  if (lock !== null) write(path.join(root, "package-lock.json"), lock)
  write(path.join(pkg, "package.json"), manifest)
  write(path.join(pkg, "dist", "runtime-identity.json"), identity)
  write(path.join(pkg, "dist", "core-provenance.json"), provenance)
  if (extraCandidate) extraCandidate({ root, pkg })
  return { workspace, root, pkg, cache: path.join(workspace, "cache") }
}

function defaultLock() {
  return {
    name: "staged",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { name: "staged", dependencies: { [CANDIDATE_PACKAGE_NAME]: `github:rpchen/opencode-litellm-provider#${SHA}` } },
      [`node_modules/${CANDIDATE_PACKAGE_NAME}`]: {
        version: IDENTITY.pluginVersion,
        resolved: `git+ssh://git@github.com/rpchen/opencode-litellm-provider.git#${SHA}`,
        license: "MIT",
        dependencies: { "jsonc-parser": "3.3.1" },
      },
      "node_modules/jsonc-parser": {
        version: "3.3.1",
        resolved: "https://registry.npmjs.org/jsonc-parser/-/jsonc-parser-3.3.1.tgz",
        integrity: "sha512-fakejsonc",
        license: "MIT",
      },
      "node_modules/solid-js": {
        version: "1.9.12",
        resolved: "https://registry.npmjs.org/solid-js/-/solid-js-1.9.12.tgz",
        integrity: "sha512-fakesolid",
        license: "MIT",
        optional: true,
      },
    },
  }
}

const ROOTS = (workspace) => ["home", "config", "cache", "data", "state"].map((name) => path.join(workspace, name))

test("locateInstalledCandidates finds the installed candidate below the run directories", () => {
  const { workspace } = installedTree({ workspace: tempWorkspace() })
  const found = locateInstalledCandidates({ roots: ROOTS(workspace), workspace })
  assert.equal(found.length, 1)
  assert.equal(found[0].manifestPath, path.join(found[0].root, "package.json"))
  assert.ok(found[0].distDir.endsWith(path.join("dist")))
})

test("locateInstalledCandidates refuses roots outside the temporary workspace", () => {
  const workspace = tempWorkspace()
  const outside = tempWorkspace()
  assert.throws(
    () => locateInstalledCandidates({ roots: [outside], workspace }),
    /outside the temporary E2E workspace/u,
  )
  assert.throws(() => locateInstalledCandidates({ roots: [path.join(workspace, "..", "escape")], workspace }), /outside/u)
})

test("locateInstalledCandidates does not follow symlinked directories", (t) => {
  const workspace = tempWorkspace()
  const real = installedTree({ workspace: tempWorkspace() })
  mkdirSync(path.join(workspace, "cache"), { recursive: true })
  try {
    symlinkSync(path.join(real.workspace, "cache"), path.join(workspace, "cache", "link"), "dir")
  } catch (error) {
    t.skip(`directory symlinks are unavailable here: ${error.code ?? error.message}`)
    return
  }
  assert.deepEqual(locateInstalledCandidates({ roots: ROOTS(workspace), workspace }), [])
})

test("readInstalledPackage returns the installed identity and refuses inconsistencies", () => {
  const { pkg } = installedTree({ workspace: tempWorkspace() })
  const installed = readInstalledPackage({ root: pkg })
  assert.deepEqual(installed.identity, IDENTITY)
  assert.deepEqual(installed.provenance, PROVENANCE)
  assert.equal(installed.manifest.version, IDENTITY.pluginVersion)

  const wrongName = installedTree({ workspace: tempWorkspace(), manifest: { name: "other-package", version: IDENTITY.pluginVersion } })
  assert.throws(() => readInstalledPackage({ root: wrongName.pkg }), /is not opencode-litellm-provider/u)

  const wrongVersion = installedTree({ workspace: tempWorkspace(), manifest: { name: CANDIDATE_PACKAGE_NAME, version: "9.9.9" } })
  assert.throws(() => readInstalledPackage({ root: wrongVersion.pkg }), /does not match its Runtime Identity/u)

  const wrongCore = installedTree({
    workspace: tempWorkspace(),
    provenance: { ...PROVENANCE, sha: "2".repeat(40) },
  })
  assert.throws(() => readInstalledPackage({ root: wrongCore.pkg }), /does not match the Runtime Identity/u)
})

test("findAncestorLock uses the nearest lock above the installed package", () => {
  const { pkg, root, workspace } = installedTree({ workspace: tempWorkspace() })
  const ancestor = findAncestorLock({ root: pkg, workspace })
  assert.equal(ancestor.lockDir, root)
  assert.equal(ancestor.lockPath, path.join(root, "package-lock.json"))
  assert.equal(findAncestorLock({ root: path.join(workspace, "missing"), workspace }), null)
  // A lock above the run's own directories is never used as evidence.
  assert.equal(findAncestorLock({ root: pkg, workspace: path.join(workspace, "home") }), null)
  assert.throws(() => findAncestorLock({ root: pkg }), /bound the lock search/u)
})

test("normalizeInstalledLock drops the empty root and the candidate's own entry only", () => {
  const normalized = normalizeInstalledLock({ lock: defaultLock(), packageName: CANDIDATE_PACKAGE_NAME, candidateSha: SHA })
  assert.equal(normalized.lockfileVersion, 3)
  assert.deepEqual(Object.keys(normalized.packages), ["node_modules/jsonc-parser", "node_modules/solid-js"])
  // External evidence keeps version/resolved/integrity and the dependency mode flags.
  assert.deepEqual(normalized.packages["node_modules/solid-js"], {
    version: "1.9.12",
    resolved: "https://registry.npmjs.org/solid-js/-/solid-js-1.9.12.tgz",
    integrity: "sha512-fakesolid",
    license: "MIT",
    optional: true,
  })
})

test("normalizeInstalledLock fails closed on missing, unbound or local evidence", () => {
  const lock = defaultLock()
  assert.throws(() => normalizeInstalledLock({ lock: {} }), /no packages section/u)
  const missingOwn = { ...lock, packages: { "": lock.packages[""], "node_modules/jsonc-parser": lock.packages["node_modules/jsonc-parser"] } }
  assert.throws(() => normalizeInstalledLock({ lock: missingOwn, candidateSha: SHA }), /no node_modules\/opencode-litellm-provider entry/u)
  const otherCommit = defaultLock()
  otherCommit.packages[`node_modules/${CANDIDATE_PACKAGE_NAME}`].resolved = `git+ssh://git@github.com/rpchen/opencode-litellm-provider.git#${"b".repeat(40)}`
  assert.throws(() => normalizeInstalledLock({ lock: otherCommit, candidateSha: SHA }), /does not bind the installed candidate commit/u)
  const localDep = defaultLock()
  localDep.packages["node_modules/jsonc-parser"].resolved = "file:../jsonc-parser"
  assert.throws(() => normalizeInstalledLock({ lock: localDep, candidateSha: SHA }), /local path/u)
  const onlyCandidate = { ...lock, packages: { "": lock.packages[""], [`node_modules/${CANDIDATE_PACKAGE_NAME}`]: lock.packages[`node_modules/${CANDIDATE_PACKAGE_NAME}`] } }
  assert.throws(() => normalizeInstalledLock({ lock: onlyCandidate, candidateSha: SHA }), /no external runtime dependencies/u)
  assert.throws(() => normalizeInstalledLock({ lock: { ...lock, lockfileVersion: "3" } }), /numeric lockfileVersion/u)
})

test("collectDeliveryInputs returns complete external evidence bound to the installed candidate", () => {
  const { workspace } = installedTree({ workspace: tempWorkspace() })
  const inputs = collectDeliveryInputs({
    roots: ROOTS(workspace),
    workspace,
    candidateSha: SHA,
    expectedIdentity: IDENTITY,
    expectedProvenance: PROVENANCE,
  })
  assert.equal(inputs.complete, true)
  assert.equal(inputs.reason, undefined)
  assert.equal(inputs.lockfileVersion, 3)
  assert.deepEqual(Object.keys(inputs.packages), ["node_modules/jsonc-parser", "node_modules/solid-js"])
  const serialized = JSON.stringify(inputs)
  assert.ok(!serialized.includes(workspace), "evidence must not contain a local path")
  assert.ok(!serialized.includes(path.basename(workspace)), "evidence must not contain the temporary directory name")
})

test("collectDeliveryInputs fails closed with a public reason instead of guessing", () => {
  const empty = tempWorkspace()
  mkdirSync(path.join(empty, "cache"), { recursive: true })
  const none = collectDeliveryInputs({ roots: ROOTS(empty), workspace: empty })
  assert.equal(none.complete, false)
  assert.match(none.reason, /no installed candidate package/u)
  assert.ok(!String(none.reason).includes(empty), "the reason must not leak the run path")

  const two = installedTree({
    workspace: tempWorkspace(),
    extraCandidate: ({ root }) => {
      const other = path.join(root, "..", "2")
      write(path.join(other, "node_modules", CANDIDATE_PACKAGE_NAME, "package.json"), { name: CANDIDATE_PACKAGE_NAME, version: IDENTITY.pluginVersion })
      write(path.join(other, "node_modules", CANDIDATE_PACKAGE_NAME, "dist", "runtime-identity.json"), IDENTITY)
      write(path.join(other, "node_modules", CANDIDATE_PACKAGE_NAME, "dist", "core-provenance.json"), PROVENANCE)
      write(path.join(other, "package-lock.json"), defaultLock())
    },
  })
  const ambiguous = collectDeliveryInputs({ roots: ROOTS(two.workspace), workspace: two.workspace, candidateSha: SHA })
  assert.equal(ambiguous.complete, false)
  assert.match(ambiguous.reason, /exactly one installed candidate is required, found 2/u)

  const mismatched = installedTree({
    workspace: tempWorkspace(),
    identity: { ...IDENTITY, pluginVersion: "0.11.3" },
    manifest: { name: CANDIDATE_PACKAGE_NAME, version: "0.11.3" },
  })
  const identity = collectDeliveryInputs({
    roots: ROOTS(mismatched.workspace),
    workspace: mismatched.workspace,
    candidateSha: SHA,
    expectedIdentity: IDENTITY,
    expectedProvenance: PROVENANCE,
  })
  assert.equal(identity.complete, false)
  assert.match(identity.reason, /does not match the candidate checkout/u)

  const noLock = installedTree({ workspace: tempWorkspace(), lock: null })
  const missingLock = collectDeliveryInputs({ roots: ROOTS(noLock.workspace), workspace: noLock.workspace, candidateSha: SHA })
  assert.equal(missingLock.complete, false)
  assert.match(missingLock.reason, /no ancestor npm lock/u)

  const badLock = installedTree({ workspace: tempWorkspace() })
  write(path.join(badLock.root, "package-lock.json"), "{not json")
  const unreadable = collectDeliveryInputs({ roots: ROOTS(badLock.workspace), workspace: badLock.workspace, candidateSha: SHA })
  assert.equal(unreadable.complete, false)
  assert.match(unreadable.reason, /is not valid JSON/u)
})

test("collectDeliveryInputs never reports a local path in its reason or evidence", () => {
  const { workspace } = installedTree({ workspace: tempWorkspace() })
  const lock = defaultLock()
  lock.packages["node_modules/solid-js"].resolved = path.join(workspace, "local-solid-js")
  const root = path.join(workspace, "cache", "opencode", "npm", "git-opencode-litellm-provider-abc123", "1")
  write(path.join(root, "package-lock.json"), lock)
  const inputs = collectDeliveryInputs({ roots: ROOTS(workspace), workspace, candidateSha: SHA })
  assert.equal(inputs.complete, false)
  assert.match(inputs.reason, /local path/u)
  assert.ok(!String(inputs.reason).includes(workspace))
})
