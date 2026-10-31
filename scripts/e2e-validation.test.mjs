#!/usr/bin/env node
/**
 * Unit tests for `scripts/e2e-validation.mjs`.
 *
 * Every case runs offline: Git comparisons use throw-away repositories in the
 * system temp directory (each test commits its own history), and the GitHub
 * side is an injected executor over fixed facts. No network, no `gh`, no real
 * host install, no user directories.
 *
 * Run with: node --test scripts/e2e-validation.test.mjs
 */
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test, { after } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

import { digestHostLock } from "./e2e-inputs.mjs"
import {
  ADAPTER_SPECS,
  BASELINE_ARTIFACT_NAME,
  BASELINE_FILE_NAME,
  BASELINE_SEARCH_LIMIT,
  DELIVERY_MODE,
  FULL_MODE,
  RECEIPT_KIND_FULL,
  RECEIPT_KIND_INCOMPLETE,
  buildReceipt,
  decidePlan,
  ensureCommit,
  fixedConfig,
  planOutputs,
  writeGithubOutput,
} from "./e2e-validation.mjs"

const REPOSITORY = "rpchen/opencode-litellm-provider"
const RUN_ID = 4242
const RUN_ATTEMPT = 2
const PR_HEAD_SHA = "1111111111111111111111111111111111111111"
const MERGE_SHA = "2222222222222222222222222222222222222222"
const CORE_SHA = "1ff0979c8f22ec06479331d94ced2cf466f1fd42"
const SCRIPT = fileURLToPath(new URL("./e2e-validation.mjs", import.meta.url))

const WORK_DIRS = []
after(() => {
  for (const dir of WORK_DIRS) rmSync(dir, { recursive: true, force: true })
})

function tmpDir(prefix) {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix))
  WORK_DIRS.push(dir)
  return dir
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "E2E Validation Test",
  GIT_AUTHOR_EMAIL: "e2e-validation@example.invalid",
  GIT_COMMITTER_NAME: "E2E Validation Test",
  GIT_COMMITTER_EMAIL: "e2e-validation@example.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV })
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`)
  return result.stdout
}

function writeFile(file, content) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, content)
}

/* ------------------------------------------------------------------------- *
 * Git fixture: a real repository with a baseline and a version-only commit
 * ------------------------------------------------------------------------- */

function writeTree(root, version) {
  writeFile(path.join(root, "package.json"), `${JSON.stringify({ name: "opencode-litellm-provider", version, private: true }, null, 2)}\n`)
  writeFile(
    path.join(root, "package-lock.json"),
    `${JSON.stringify(
      {
        name: "opencode-litellm-provider",
        version,
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { name: "opencode-litellm-provider", version, dependencies: { "@opencode-ai/plugin": "1.2.3" } },
          "node_modules/@opencode-ai/plugin": { version: "1.2.3", resolved: "https://registry.example.invalid/plugin-1.2.3.tgz" },
        },
      },
      null,
      2,
    )}\n`,
  )
  writeFile(
    path.join(root, "dist", "runtime-identity.json"),
    `${JSON.stringify({ host: "opencode", pluginVersion: version, artifactDigest: "sha256:0123456789abcdef", coreCommit: CORE_SHA }, null, 2)}\n`,
  )
  writeFile(path.join(root, "scripts", "e2e-opencode-v2.mjs"), "// real host E2E harness\nexport const harness = true\n")
  writeFile(path.join(root, ".github", "workflows", "ci.yml"), "name: CI\n")
  writeFile(path.join(root, "README.md"), `# opencode-litellm-provider\n\nCurrent version: ${version}\n`)
}

function commitAll(root, message) {
  git(root, ["add", "-A"])
  git(root, ["commit", "-q", "-m", message])
  return git(root, ["rev-parse", "HEAD"]).trim()
}

function initRepo() {
  const root = tmpDir("e2e-validation-git-")
  git(root, ["init", "-q", "-b", "main"])
  git(root, ["config", "user.name", "E2E Validation Test"])
  git(root, ["config", "user.email", "e2e-validation@example.invalid"])
  return root
}

/**
 * Baseline commit (version 1.0.0) plus one allowed release commit:
 * README, the new release notes and the three version fields only.
 */
function createVersionFixture() {
  const root = initRepo()
  writeTree(root, "1.0.0")
  writeFile(path.join(root, "README.md"), "# opencode-litellm-provider\n\nCurrent version: 1.0.0\n")
  const base = commitAll(root, "chore: baseline")

  writeTree(root, "1.1.0")
  writeFile(path.join(root, "README.md"), "# opencode-litellm-provider\n\nCurrent version: 1.1.0\n")
  writeFile(path.join(root, "docs", "releases", "v1.1.0.md"), "# 1.1.0\n\n- version only\n")
  const current = commitAll(root, "chore: release v1.1.0")
  return { root, base, current }
}

/** One shared read-only fixture; every test only reads its two commits. */
let sharedVersionFixture = null
function versionFixture() {
  if (!sharedVersionFixture) sharedVersionFixture = createVersionFixture()
  return sharedVersionFixture
}

function addHarnessChange(root) {
  writeFile(path.join(root, "scripts", "e2e-opencode-v2.mjs"), "// a changed harness script\nexport const harness = false\n")
  return commitAll(root, "fix: change the harness")
}

/* ------------------------------------------------------------------------- *
 * Host input, reports and receipts
 * ------------------------------------------------------------------------- */

const HOST_MANIFEST = `${JSON.stringify(
  { name: "opencode-e2e-host", private: true, version: "0.0.0", dependencies: { "@opencode/cli": "2.0.16" } },
  null,
  2,
)}\n`
const HOST_LOCK = `${JSON.stringify(
  {
    name: "opencode-e2e-host",
    version: "0.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { name: "opencode-e2e-host", version: "0.0.0", dependencies: { "@opencode/cli": "2.0.16" } },
      "node_modules/@opencode/cli": { version: "2.0.16", resolved: "https://registry.example.invalid/cli-2.0.16.tgz" },
    },
  },
  null,
  2,
)}\n`
const HOST_LOCK_DIGEST = digestHostLock({ packageJson: HOST_MANIFEST, packageLock: HOST_LOCK })

function hostInputRecord({ hostVersion = "2.0.16", hostPackage = "@opencode/cli", candidateSha = null } = {}) {
  return {
    hostPackage,
    hostVersion,
    candidateSha,
    node: "v22.23.4",
    npm: "10.9.2",
    os: { platform: "linux", arch: "x64", release: "6.8.0-1021-azure" },
    runner: { ImageOS: "ubuntu24", ImageVersion: "20250101.1.0" },
    resolvedAt: "2026-01-01T00:00:00.000Z",
    packageSpec: `github:${REPOSITORY}#${candidateSha ?? "0".repeat(40)}`,
    hostBin: "/home/runner/work/_temp/e2e-host/node_modules/.bin/opencode",
    hostLock: ["package.json", "package-lock.json"],
  }
}

const DELIVERY_INPUTS = {
  complete: true,
  hostPackage: "@opencode/cli",
  hostVersion: "2.0.16",
  pluginRuntime: { "@opencode-ai/plugin": "1.2.3" },
  peerContract: { plugin: "^1.2.0" },
}

function makeHostDir({ manifest = HOST_MANIFEST, lock = HOST_LOCK, hostInput = hostInputRecord() } = {}) {  const dir = tmpDir("e2e-validation-host-")
  writeFile(path.join(dir, "package.json"), manifest)
  writeFile(path.join(dir, "package-lock.json"), lock)
  writeFile(path.join(dir, "host-input.json"), `${JSON.stringify(hostInput, null, 2)}\n`)
  return dir
}

function writeDeliveryReport({ status = "ok", scope = "delivery", hostInput = hostInputRecord(), deliveryInputs = DELIVERY_INPUTS } = {}) {
  const file = path.join(tmpDir("e2e-validation-report-"), "delivery-timing.json")
  const report = { group: "delivery", script: "scripts/e2e-opencode-v2.mjs", durationMs: 1234, status, scope, hostInput, deliveryInputs }
  writeFile(file, `${JSON.stringify(report, null, 2)}\n`)
  return file
}

function groupReport(group, { scope = "full", status = "ok", hostInput = hostInputRecord(), deliveryInputs = DELIVERY_INPUTS } = {}) {
  const report = { group, script: "scripts/e2e-opencode-v2.mjs", status, durationMs: 1000 }
  if (scope !== null) report.scope = scope
  if (hostInput !== null) report.hostInput = hostInput
  if (deliveryInputs !== null) report.deliveryInputs = deliveryInputs
  return report
}

function makeReportsDir(entries, { nested = false } = {}) {
  const dir = tmpDir("e2e-validation-reports-")
  const list = Array.isArray(entries) ? entries : Object.entries(entries).map(([group, report]) => ({ file: `${group.toLowerCase()}.json`, report }))
  for (const { file, report } of list) {
    const target = nested ? path.join(dir, `e2e-timing-group-${file.replace(/\.json$/u, "")}`, "timing", file) : path.join(dir, file)
    writeFile(target, typeof report === "string" ? report : `${JSON.stringify(report, null, 2)}\n`)
  }
  return dir
}

function fullGroups() {
  return { A: "success", B: "success", C: "success", D: "success" }
}

function fullReceipt({
  adapter = "opencode",
  kind = RECEIPT_KIND_FULL,
  groups = fullGroups(),
  candidateSha,
  harnessSha,
  sourceHeadSha = PR_HEAD_SHA,
  runId = RUN_ID,
  runAttempt = RUN_ATTEMPT,
  repository = REPOSITORY,
  lockDigest = HOST_LOCK_DIGEST,
  hostInput = hostInputRecord(),
  deliveryInputs = DELIVERY_INPUTS,
  config = fixedConfig(adapter),
} = {}) {
  return {
    schemaVersion: 1,
    kind,
    adapter,
    repository,
    runId,
    runAttempt,
    sourceHeadSha,
    harnessSha,
    candidateSha,
    groups,
    host: { hostInput, lockDigest, config },
    deliveryInputs,
    evidence: { groupReports: [] },
  }
}

/* ------------------------------------------------------------------------- *
 * GitHub facts
 * ------------------------------------------------------------------------- */

function step(name, { status = "completed", conclusion = "success" } = {}) {
  return { name, status, conclusion }
}

function job(name, steps = []) {
  return { name, status: "completed", conclusion: "success", steps }
}

function opencodeJobs() {
  return [
    job("Resolve real host input", [step("Resolve and lock the latest host in a private npm project")]),
    job(ADAPTER_SPECS.opencode.jobs[0].name, [step("Run real host E2E group A")]),
    job(ADAPTER_SPECS.opencode.jobs[1].name, [step("Run real host E2E group B")]),
    job(ADAPTER_SPECS.opencode.jobs[2].name, [step("Run real host E2E group C")]),
    job(ADAPTER_SPECS.opencode.jobs[3].name, [step("Run real host E2E group D")]),
    job("Real OpenCode latest E2E", [step("Require the resolved host and all four groups to succeed")]),
  ]
}

function baseRun(runId, overrides = {}) {
  return {
    id: runId,
    status: "completed",
    conclusion: "success",
    run_attempt: RUN_ATTEMPT,
    path: ".github/workflows/ci.yml",
    head_sha: PR_HEAD_SHA,
    head_repository: { full_name: REPOSITORY },
    pull_requests: [{ head: { sha: PR_HEAD_SHA } }],
    html_url: `https://github.com/${REPOSITORY}/actions/runs/${runId}`,
    ...overrides,
  }
}

/**
 * Inject the GitHub facts. `limits` records the arguments of every call so the
 * tests can assert the bounded search and the current-run exclusion.
 */
function fakeGithub({
  runs = [{ id: RUN_ID }],
  run = {},
  receipt = null,
  jobs = opencodeJobs(),
  jobsComplete = true,
  artifacts = [{ name: BASELINE_ARTIFACT_NAME, expired: false }],
  artifactsComplete = true,
  download = null,
} = {}) {
  const calls = { runs: 0, run: 0, artifacts: 0, download: 0, jobs: 0 }
  const limits = { runs: null }
  return {
    calls,
    limits,
    listSuccessfulRuns({ limit }) {
      calls.runs += 1
      limits.runs = limit
      return { ok: true, runs: runs.slice(0, limit) }
    },
    getRun({ runId }) {
      calls.run += 1
      return { ok: true, run: baseRun(runId, run) }
    },
    listArtifacts({ runId }) {
      calls.artifacts += 1
      return { ok: true, artifacts: typeof artifacts === "function" ? artifacts(runId) : artifacts, complete: artifactsComplete }
    },
    downloadArtifact({ dir }) {
      calls.download += 1
      if (download) return download({ dir })
      if (!receipt) return { ok: false, reason: "no receipt fixture" }
      mkdirSync(dir, { recursive: true })
      writeFileSync(path.join(dir, BASELINE_FILE_NAME), `${JSON.stringify(receipt, null, 2)}\n`)
      return { ok: true }
    },
    listJobs({ runId, attempt }) {
      calls.jobs += 1
      return { ok: true, jobs: typeof jobs === "function" ? jobs(runId, attempt) : jobs, complete: jobsComplete }
    },
  }
}

/* ------------------------------------------------------------------------- *
 * plan world
 * ------------------------------------------------------------------------- */

function createPlanWorld({ candidate, harness } = {}) {
  const repo = versionFixture()
  const hostDir = makeHostDir({ hostInput: hostInputRecord({ candidateSha: repo.current }) })
  const receipt = fullReceipt({
    candidateSha: repo.base,
    harnessSha: repo.base,
    hostInput: hostInputRecord({ candidateSha: repo.base }),
  })
  return {
    root: repo.root,
    base: repo.base,
    current: repo.current,
    hostDir,
    deliveryReport: writeDeliveryReport({ hostInput: hostInputRecord({ candidateSha: repo.current }) }),
    receipt,
    github: fakeGithub({ receipt }),
    planArgs(overrides = {}) {
      return {
        adapter: "opencode",
        root: repo.root,
        hostDir,
        deliveryReport: writeDeliveryReport({ hostInput: hostInputRecord({ candidateSha: repo.current }) }),
        candidate: candidate ?? repo.current,
        harness: harness ?? repo.current,
        sourceHead: PR_HEAD_SHA,
        repository: REPOSITORY,
        currentRunId: 9999,
        github: this.github,
        ...overrides,
      }
    },
  }
}

function assertFull(decision, pattern) {
  assert.equal(decision.mode, FULL_MODE, `expected full, got ${decision.mode}: ${decision.reason}`)
  assert.equal(decision.plan.mode, FULL_MODE)
  if (pattern) assert.match(decision.reason, pattern)
}

function assertDelivery(decision) {
  assert.equal(decision.mode, DELIVERY_MODE, `expected delivery, got full: ${decision.reason}`)
  assert.equal(decision.plan.mode, DELIVERY_MODE)
}

/* ------------------------------------------------------------------------- *
 * plan: positives
 * ------------------------------------------------------------------------- */

test("plan reuses a complete matrix when only version inputs changed", () => {
  const world = createPlanWorld()
  const decision = decidePlan(world.planArgs())
  assertDelivery(decision)
  assert.deepEqual(decision.plan.baseline, {
    runId: RUN_ID,
    runAttempt: RUN_ATTEMPT,
    url: `https://github.com/${REPOSITORY}/actions/runs/${RUN_ID}`,
  })
  assert.equal(decision.plan.candidateSha, world.current)
  assert.equal(decision.plan.harnessSha, world.current)
  assert.equal(decision.plan.sourceHeadSha, PR_HEAD_SHA)
  assert.equal(world.github.limits.runs, BASELINE_SEARCH_LIMIT)
  assert.ok(decision.plan.evidence.git.candidate.some((change) => change.endsWith("docs/releases/v1.1.0.md")))
  assert.ok(decision.plan.evidence.git.candidate.includes("modified README.md"))
  assert.equal(JSON.stringify(decision.plan).includes(world.root), false, "plan evidence must not leak local paths")
})

test("plan reuses when candidate and harness have the same tree as the baseline", () => {
  const world = createPlanWorld({ candidate: null, harness: null })
  const hostInput = hostInputRecord({ candidateSha: world.base })
  const decision = decidePlan(
    world.planArgs({
      candidate: world.base,
      harness: world.base,
      hostDir: makeHostDir({ hostInput }),
      deliveryReport: writeDeliveryReport({ hostInput }),
    }),
  )
  assertDelivery(decision)
  assert.deepEqual(decision.plan.evidence.git.candidate, [])
  assert.deepEqual(decision.plan.evidence.git.harness, [])
})

test("plan reuses a Pi baseline with the full Pi job and step", () => {
  const repo = versionFixture()
  const piHostInput = hostInputRecord({ hostPackage: "@earendil-works/pi-coding-agent", hostVersion: "1.4.0" })
  const hostDir = makeHostDir({ hostInput: piHostInput })
  const deliveryInputs = { complete: true, hostPackage: "@earendil-works/pi-coding-agent", hostVersion: "1.4.0" }
  const receipt = fullReceipt({
    adapter: "pi",
    groups: { pi: "success" },
    candidateSha: repo.base,
    harnessSha: repo.base,
    hostInput: piHostInput,
    deliveryInputs,
    config: fixedConfig("pi"),
  })
  const github = fakeGithub({
    receipt,
    jobs: [job("Real Pi latest E2E", [step("Run full real Pi host E2E")])],
  })
  const decision = decidePlan({
    adapter: "pi",
    root: repo.root,
    hostDir,
    deliveryReport: writeDeliveryReport({ hostInput: piHostInput, deliveryInputs }),
    candidate: repo.current,
    harness: repo.current,
    sourceHead: PR_HEAD_SHA,
    repository: REPOSITORY,
    currentRunId: 9999,
    github,
  })
  assertDelivery(decision)
  assert.equal(decision.plan.baseline.runId, RUN_ID)
})

test("plan accepts the pre-rename Pi full step name", () => {
  const repo = versionFixture()
  const piHostInput = hostInputRecord({ hostPackage: "@earendil-works/pi-coding-agent", hostVersion: "1.4.0" })
  const receipt = fullReceipt({
    adapter: "pi",
    groups: { pi: "success" },
    candidateSha: repo.base,
    harnessSha: repo.base,
    hostInput: piHostInput,
    deliveryInputs: { complete: true, hostPackage: "@earendil-works/pi-coding-agent" },
    config: fixedConfig("pi"),
  })
  const github = fakeGithub({
    receipt,
    jobs: [job("Real Pi latest E2E", [step("Run real host E2E against immutable Git candidate")])],
  })
  const decision = decidePlan({
    adapter: "pi",
    root: repo.root,
    hostDir: makeHostDir({ hostInput: piHostInput }),
    deliveryReport: writeDeliveryReport({ hostInput: piHostInput, deliveryInputs: { complete: true, hostPackage: "@earendil-works/pi-coding-agent" } }),
    candidate: repo.current,
    harness: repo.current,
    sourceHead: PR_HEAD_SHA,
    repository: REPOSITORY,
    currentRunId: 9999,
    github,
  })
  assertDelivery(decision)
})

/* ------------------------------------------------------------------------- *
 * plan: report and host negatives
 * ------------------------------------------------------------------------- */

test("plan defaults to full when the delivery verification report is missing", () => {
  const world = createPlanWorld()
  const decision = decidePlan(world.planArgs({ deliveryReport: path.join(tmpDir("e2e-validation-none-"), "absent.json") }))
  assertFull(decision, /delivery verification report/u)
})

test("plan defaults to full when the delivery verification did not succeed", () => {
  const world = createPlanWorld()
  assertFull(decidePlan(world.planArgs({ deliveryReport: writeDeliveryReport({ status: "failed" }) })), /status/u)
  assertFull(decidePlan(world.planArgs({ deliveryReport: writeDeliveryReport({ scope: "full" }) })), /scope/u)
})

test("plan defaults to full when the runtime dependency evidence is incomplete", () => {
  const world = createPlanWorld()
  const report = writeDeliveryReport({ deliveryInputs: { complete: false, reason: "unknown dependency" } })
  assertFull(decidePlan(world.planArgs({ deliveryReport: report })), /not complete/u)
})

test("plan defaults to full when the delivery report ran on another host input", () => {
  const world = createPlanWorld()
  const report = writeDeliveryReport({ hostInput: hostInputRecord({ hostVersion: "2.0.15" }) })
  assertFull(decidePlan(world.planArgs({ deliveryReport: report })), /different host input/u)
})

test("plan defaults to full when the resolved host directory is incomplete", () => {
  const world = createPlanWorld()
  const empty = tmpDir("e2e-validation-empty-host-")
  assertFull(decidePlan(world.planArgs({ hostDir: empty })), /host-input\.json is missing/u)
})

/* ------------------------------------------------------------------------- *
 * plan: receipt / artifact negatives
 * ------------------------------------------------------------------------- */

test("plan rejects a delivery record as a recursive baseline", () => {
  const world = createPlanWorld()
  world.github = fakeGithub({ receipt: { ...world.receipt, kind: "delivery" } })
  const decision = decidePlan(world.planArgs())
  assertFull(decision, /kind "delivery" is not "full"/u)
})

test("plan rejects a baseline with a failed or missing group", () => {
  const world = createPlanWorld()
  world.github = fakeGithub({ receipt: { ...world.receipt, groups: { A: "success", B: "success", C: "failure", D: "success" } } })
  assertFull(decidePlan(world.planArgs()), /group "C"/u)

  world.github = fakeGithub({ receipt: { ...world.receipt, groups: { A: "success", B: "success", C: "success" } } })
  assertFull(decidePlan(world.planArgs()), /required group "D" is missing/u)
})

test("plan rejects an expired baseline artifact", () => {
  const world = createPlanWorld()
  world.github = fakeGithub({ receipt: world.receipt, artifacts: [{ name: BASELINE_ARTIFACT_NAME, expired: true }] })
  assertFull(decidePlan(world.planArgs()), /expired/u)
})

test("plan rejects a missing baseline artifact", () => {
  const world = createPlanWorld()
  world.github = fakeGithub({ receipt: world.receipt, artifacts: [] })
  assertFull(decidePlan(world.planArgs()), /has no e2e-full-validation artifact/u)
})

test("plan rejects a fake artifact that is not a complete matrix or not JSON", () => {
  const world = createPlanWorld()
  const partial = fullReceipt({ candidateSha: world.base, harnessSha: world.base, groups: { A: "success" } })
  world.github = fakeGithub({ receipt: partial })
  assertFull(decidePlan(world.planArgs()), /not a complete matrix/u)

  world.github = fakeGithub({
    download: ({ dir }) => {
      mkdirSync(dir, { recursive: true })
      writeFileSync(path.join(dir, BASELINE_FILE_NAME), "not json at all\n")
      return { ok: true }
    },
  })
  assertFull(decidePlan(world.planArgs()), /not valid JSON/u)

  world.github = fakeGithub({
    download: ({ dir }) => {
      mkdirSync(dir, { recursive: true })
      writeFileSync(path.join(dir, "other.json"), "{}\n")
      return { ok: true }
    },
  })
  assertFull(decidePlan(world.planArgs()), /does not contain validation\.json/u)
})

test("plan rejects a baseline artifact of a superseded attempt", () => {
  const world = createPlanWorld()
  world.github = fakeGithub({ receipt: { ...world.receipt, runAttempt: 1 } })
  assertFull(decidePlan(world.planArgs()), /is now at attempt 2/u)
})

test("plan rejects a record that was downloaded from another run", () => {
  const world = createPlanWorld()
  world.github = fakeGithub({ receipt: { ...world.receipt, runId: RUN_ID + 1 } })
  assertFull(decidePlan(world.planArgs()), /belongs to run 4243, but was downloaded from run 4242/u)
})

test("plan binds immutable run head while allowing a PR to move on", () => {
  const world = createPlanWorld()
  const movedHead = "3333333333333333333333333333333333333333"
  world.github = fakeGithub({ receipt: world.receipt, run: { pull_requests: [{ head: { sha: movedHead } }] } })
  assertDelivery(decidePlan(world.planArgs()))
  world.github = fakeGithub({ receipt: world.receipt, run: { head_sha: movedHead } })
  assertFull(decidePlan(world.planArgs()), /claims source head/u)
})

test("plan rejects a host input that installed another candidate", () => {
  const world = createPlanWorld()
  world.github = fakeGithub({ receipt: world.receipt })
  const hostDir = makeHostDir({ hostInput: hostInputRecord({ candidateSha: world.base }) })
  assertFull(decidePlan(world.planArgs({ hostDir })), /resolved host input installed candidate/u)

  const report = writeDeliveryReport({ hostInput: hostInputRecord({ candidateSha: world.base }) })
  assertFull(decidePlan(world.planArgs({ deliveryReport: report })), /delivery verification installed candidate/u)
})

test("plan rejects a baseline host input that contradicts the recorded candidate", () => {
  const world = createPlanWorld()
  world.github = fakeGithub({
    receipt: fullReceipt({
      candidateSha: world.base,
      harnessSha: world.base,
      hostInput: hostInputRecord({ candidateSha: world.current }),
    }),
  })
  assertFull(decidePlan(world.planArgs()), /baseline host input installed candidate/u)
})

/* ------------------------------------------------------------------------- *
 * plan: run and job negatives
 * ------------------------------------------------------------------------- */

test("plan rejects a run that did not complete successfully", () => {
  const world = createPlanWorld()
  world.github = fakeGithub({ receipt: world.receipt, run: { status: "in_progress", conclusion: null } })
  assertFull(decidePlan(world.planArgs()), /expected "completed"/u)

  world.github = fakeGithub({ receipt: world.receipt, run: { conclusion: "cancelled" } })
  assertFull(decidePlan(world.planArgs()), /expected "success"/u)
})

test("plan rejects a run of another workflow or repository", () => {
  const world = createPlanWorld()
  world.github = fakeGithub({ receipt: world.receipt, run: { path: ".github/workflows/release.yml" } })
  assertFull(decidePlan(world.planArgs()), /workflow path/u)

  world.github = fakeGithub({ receipt: world.receipt, run: { head_repository: { full_name: "someone/fork" } } })
  assertFull(decidePlan(world.planArgs()), /head repository/u)
})

test("plan rejects a run whose source head differs from the record", () => {
  const world = createPlanWorld()
  world.github = fakeGithub({ receipt: { ...world.receipt, sourceHeadSha: MERGE_SHA } })
  assertFull(decidePlan(world.planArgs()), /source head/u)
})

test("plan rejects a full E2E step that was skipped", () => {
  const world = createPlanWorld()
  const jobs = opencodeJobs()
  jobs[3].steps = [step("Run real host E2E group C", { conclusion: "skipped" })]
  world.github = fakeGithub({ receipt: world.receipt, jobs })
  assertFull(decidePlan(world.planArgs()), /Run real host E2E group C.*expected "success"/u)
})

test("plan rejects a skipped group job", () => {
  const world = createPlanWorld()
  const jobs = opencodeJobs()
  jobs[5].status = "skipped"
  jobs[5].conclusion = "skipped"
  world.github = fakeGithub({ receipt: world.receipt, jobs })
  assertFull(decidePlan(world.planArgs()), /Real OpenCode latest E2E" has status "skipped"/u)
})

test("plan rejects a missing group job", () => {
  const world = createPlanWorld()
  const jobs = opencodeJobs().filter((entry) => !entry.name.includes("group D"))
  world.github = fakeGithub({ receipt: world.receipt, jobs })
  assertFull(decidePlan(world.planArgs()), /group D \(notifications, failure recovery\)" did not run/u)
})

/* ------------------------------------------------------------------------- *
 * plan: input comparison negatives
 * ------------------------------------------------------------------------- */

test("plan requires the harness tree to match the baseline", () => {
  const repo = createVersionFixture()
  const changedHarness = addHarnessChange(repo.root)
  const world = createPlanWorld()
  world.github = fakeGithub({ receipt: fullReceipt({ candidateSha: repo.base, harnessSha: repo.base }) })
  const decision = decidePlan(
    world.planArgs({
      root: repo.root,
      candidate: repo.current,
      harness: changedHarness,
    }),
  )
  assertFull(decision, /harness scripts\/e2e-opencode-v2\.mjs/u)
})

test("plan requires the host input to match the baseline", () => {
  const world = createPlanWorld()
  world.github = fakeGithub({ receipt: fullReceipt({ candidateSha: world.base, harnessSha: world.base, hostInput: hostInputRecord({ hostVersion: "2.0.15" }) }) })
  assertFull(decidePlan(world.planArgs()), /hostVersion differs/u)
})

test("plan requires the runtime dependency evidence to match the baseline", () => {
  const world = createPlanWorld()
  const report = writeDeliveryReport({ deliveryInputs: { ...DELIVERY_INPUTS, pluginRuntime: { "@opencode-ai/plugin": "1.2.4" } } })
  assertFull(decidePlan(world.planArgs({ deliveryReport: report })), /runtime dependency evidence differs/u)
})

test("plan defaults to full when the repository or a SHA is unusable", () => {
  const world = createPlanWorld()
  assertFull(decidePlan(world.planArgs({ repository: null })), /not owner\/name/u)
  assertFull(decidePlan(world.planArgs({ candidate: "HEAD" })), /candidate must be a full 40-character/u)
  assertFull(decidePlan(world.planArgs({ sourceHead: "" })), /source-head must be a full 40-character/u)
})

test("plan honours an explicit force-full request", () => {
  const world = createPlanWorld()
  const decision = decidePlan(world.planArgs({ forceFull: true }))
  assertFull(decision, /requested explicitly/u)
  assert.equal(decision.plan.baseline, undefined)
  assert.equal(world.github.calls.runs, 0)
})

test("plan skips the current run and bounds the search to 20 runs", () => {
  const world = createPlanWorld()
  world.github = fakeGithub({ receipt: world.receipt, runs: [{ id: 9999 }] })
  assertFull(decidePlan(world.planArgs()), /no previous run/u)
  assert.equal(world.github.calls.run, 0)

  const many = Array.from({ length: BASELINE_SEARCH_LIMIT + 5 }, (_, index) => ({ id: 5000 + index }))
  world.github = fakeGithub({ receipt: world.receipt, runs: many, artifacts: [{ name: BASELINE_ARTIFACT_NAME, expired: true }] })
  assertFull(decidePlan(world.planArgs()))
  assert.equal(world.github.calls.run, BASELINE_SEARCH_LIMIT)
})

/* ------------------------------------------------------------------------- *
 * plan: missing baseline commits
 * ------------------------------------------------------------------------- */

test("ensureCommit fetches a baseline commit that the checkout does not have", () => {
  const bare = tmpDir("e2e-validation-origin-")
  git(bare, ["init", "-q", "--bare", "-b", "main"])
  git(bare, ["config", "uploadpack.allowAnySHA1InWant", "true"])

  const upstream = createVersionFixture()
  git(upstream.root, ["remote", "add", "origin", pathToFileURL(bare).href])
  git(upstream.root, ["push", "-q", "origin", "main"])

  const checkout = initRepo()
  writeTree(checkout, "1.1.0")
  const shallowTip = commitAll(checkout, "chore: unrelated checkout")
  git(checkout, ["remote", "add", "origin", pathToFileURL(bare).href])

  const missing = spawnSync("git", ["cat-file", "-e", `${upstream.base}^{commit}`], { cwd: checkout, encoding: "utf8" })
  assert.notEqual(missing.status, 0, "the fixture must not contain the baseline commit yet")

  const fetched = ensureCommit({ root: checkout, sha: upstream.base })
  assert.equal(fetched.ok, true, fetched.reason)
  assert.equal(fetched.fetched, true)

  const world = createPlanWorld()
  world.github = fakeGithub({ receipt: fullReceipt({ candidateSha: upstream.base, harnessSha: upstream.base }) })
  const hostInput = hostInputRecord({ candidateSha: shallowTip })
  const decision = decidePlan(
    world.planArgs({
      root: checkout,
      candidate: shallowTip,
      harness: shallowTip,
      hostDir: makeHostDir({ hostInput }),
      deliveryReport: writeDeliveryReport({ hostInput }),
    }),
  )
  assertDelivery(decision)
})

test("plan defaults to full when a baseline commit cannot be fetched", () => {
  const world = createPlanWorld()
  const unknown = "abcdefabcdefabcdefabcdefabcdefabcdefabcd"
  world.github = fakeGithub({ receipt: fullReceipt({ candidateSha: unknown, harnessSha: world.base }) })
  assertFull(decidePlan(world.planArgs()), /could not be fetched from origin/u)
})

/* ------------------------------------------------------------------------- *
 * GITHUB_OUTPUT
 * ------------------------------------------------------------------------- */

test("plan outputs the verification mode and reason for GITHUB_OUTPUT", () => {
  const world = createPlanWorld()
  const decision = decidePlan(world.planArgs())
  const outputs = planOutputs({ decision })
  assert.equal(outputs["verification-mode"], DELIVERY_MODE)
  assert.equal(outputs["verification-baseline"], `${RUN_ID}/${RUN_ATTEMPT}`)

  const file = path.join(tmpDir("e2e-validation-output-"), "github-output")
  assert.deepEqual(writeGithubOutput({ file, values: outputs }), { ok: true, written: true })
  const text = readFileSync(file, "utf8")
  assert.match(text, /^verification-mode=delivery$/mu)
  assert.match(text, /^verification-baseline=4242\/2$/mu)

  const fullOutputs = planOutputs({ decision: decidePlan(world.planArgs({ forceFull: true })) })
  assert.equal(fullOutputs["verification-mode"], FULL_MODE)
  assert.equal(fullOutputs["verification-baseline"], "none")
})

/* ------------------------------------------------------------------------- *
 * record
 * ------------------------------------------------------------------------- */

function recordArgs(world, reportsDir, overrides = {}) {
  return {
    adapter: "opencode",
    hostDir: world.hostDir,
    reportsDir,
    candidate: world.current,
    harness: world.current,
    sourceHead: PR_HEAD_SHA,
    repository: REPOSITORY,
    runId: RUN_ID,
    runAttempt: RUN_ATTEMPT,
    ...overrides,
  }
}

function defaultReports(overrides = {}) {
  return ["A", "B", "C", "D"].map((group) => ({
    file: `e2e-timing-${group.toLowerCase()}.json`,
    report: groupReport(group, overrides[group] ?? {}),
  }))
}

test("record produces a reusable full baseline from four full group reports", () => {
  const world = createPlanWorld()
  const built = buildReceipt(recordArgs(world, makeReportsDir(defaultReports(), { nested: true })))
  assert.equal(built.ok, true, built.receipt.reason)
  const receipt = built.receipt
  assert.equal(receipt.kind, RECEIPT_KIND_FULL)
  assert.equal(receipt.schemaVersion, 1)
  assert.equal(receipt.repository, REPOSITORY)
  assert.equal(receipt.runId, RUN_ID)
  assert.equal(receipt.runAttempt, RUN_ATTEMPT)
  assert.equal(receipt.candidateSha, world.current)
  assert.equal(receipt.harnessSha, world.current)
  assert.equal(receipt.sourceHeadSha, PR_HEAD_SHA)
  assert.deepEqual(receipt.groups, fullGroups())
  assert.equal(receipt.host.lockDigest, HOST_LOCK_DIGEST)
  assert.deepEqual(receipt.host.config, fixedConfig("opencode"))
  assert.deepEqual(receipt.deliveryInputs, DELIVERY_INPUTS)
  assert.deepEqual(
    receipt.evidence.groupReports.map((entry) => entry.group),
    ["A", "B", "C", "D"],
  )
  for (const entry of receipt.evidence.groupReports) assert.equal(path.isAbsolute(entry.file), false)
  assert.equal(JSON.stringify(receipt).includes(world.hostDir), false, "the record must not contain local paths")
  assert.equal(JSON.stringify(receipt).includes(os.tmpdir()), false, "the record must not contain temp paths")
})

test("record ignores JSON files that are not E2E reports", () => {
  const world = createPlanWorld()
  const reports = defaultReports()
  reports.push({ file: "upload-metadata.json", report: { note: "artifact bookkeeping" } })
  const built = buildReceipt(recordArgs(world, makeReportsDir(reports)))
  assert.equal(built.ok, true, built.receipt.reason)
  assert.deepEqual(built.receipt.evidence.ignoredReports, ["upload-metadata.json"])
})

test("record does not produce a baseline when a group ran only the delivery verification", () => {
  const world = createPlanWorld()
  const built = buildReceipt(recordArgs(world, makeReportsDir(defaultReports({ C: { scope: "delivery" } }))))
  assert.equal(built.ok, false)
  assert.equal(built.receipt.kind, RECEIPT_KIND_INCOMPLETE)
  assert.match(built.receipt.reason, /group C reported scope "delivery"/u)
})

test("record does not produce a baseline when a group failed", () => {
  const world = createPlanWorld()
  const built = buildReceipt(recordArgs(world, makeReportsDir(defaultReports({ B: { status: "failed" } }))))
  assert.equal(built.ok, false)
  assert.match(built.receipt.reason, /group B reported status "failed"/u)
})

test("record does not produce a baseline when a group report is missing or duplicated", () => {
  const world = createPlanWorld()
  const missing = defaultReports().filter((entry) => !entry.file.endsWith("d.json"))
  assert.match(buildReceipt(recordArgs(world, makeReportsDir(missing))).receipt.reason, /group D produced no report/u)

  const duplicated = [...defaultReports(), { file: "e2e-timing-a-retry.json", report: groupReport("A") }]
  assert.match(buildReceipt(recordArgs(world, makeReportsDir(duplicated))).receipt.reason, /group A has more than one report/u)
})

test("record does not produce a baseline from legacy timing reports without scope", () => {
  const world = createPlanWorld()
  const legacy = ["A", "B", "C", "D"].map((group) => ({
    file: `e2e-timing-${group.toLowerCase()}.json`,
    report: { group, script: "scripts/e2e-opencode-v2.mjs", status: "ok", durationMs: 1000 },
  }))
  const built = buildReceipt(recordArgs(world, makeReportsDir(legacy)))
  assert.equal(built.ok, false)
  assert.match(built.receipt.reason, /expected "full"/u)
  assert.match(built.receipt.reason, /no complete deliveryInputs/u)
})

test("record does not produce a baseline when delivery inputs are incomplete or differ", () => {
  const world = createPlanWorld()
  const incomplete = buildReceipt(
    recordArgs(world, makeReportsDir(defaultReports({ A: { deliveryInputs: { complete: false, reason: "unknown" } } }))),
  )
  assert.equal(incomplete.ok, false)
  assert.match(incomplete.receipt.reason, /group A reported no complete deliveryInputs/u)

  const different = buildReceipt(
    recordArgs(
      world,
      makeReportsDir(defaultReports({ D: { deliveryInputs: { ...DELIVERY_INPUTS, pluginRuntime: { "@opencode-ai/plugin": "9.9.9" } } } })),
    ),
  )
  assert.equal(different.ok, false)
  assert.match(different.receipt.reason, /the deliveryInputs of group D differ from group A/u)
})

test("record does not produce a baseline when a group ran on another host input", () => {
  const world = createPlanWorld()
  const built = buildReceipt(
    recordArgs(world, makeReportsDir(defaultReports({ C: { hostInput: hostInputRecord({ hostVersion: "2.0.15" }) } }))),
  )
  assert.equal(built.ok, false)
  assert.match(built.receipt.reason, /group C ran with a different host input/u)
})

test("record does not produce a baseline when the host input installed another candidate", () => {
  const world = createPlanWorld()
  const hostDir = makeHostDir({ hostInput: hostInputRecord({ candidateSha: world.base }) })
  const built = buildReceipt(recordArgs(world, makeReportsDir(defaultReports()), { hostDir }))
  assert.equal(built.ok, false)
  assert.match(built.receipt.reason, /resolved host input installed candidate/u)
})

test("record does not produce a baseline when the triggering head is unknown", () => {
  const world = createPlanWorld()
  const built = buildReceipt(recordArgs(world, makeReportsDir(defaultReports()), { sourceHead: null }))
  assert.equal(built.ok, false)
  assert.match(built.receipt.reason, /source-head must be a full 40-character/u)
})

test("record does not produce a baseline when the resolved host directory is missing", () => {
  const world = createPlanWorld()
  const built = buildReceipt(recordArgs(world, makeReportsDir(defaultReports()), { hostDir: path.join(tmpDir("e2e-validation-empty-"), "absent") }))
  assert.equal(built.ok, false)
  assert.match(built.receipt.reason, /package\.json is missing/u)
})

test("record keeps the candidate, harness and source head separate", () => {
  const world = createPlanWorld()
  const base = world.base
  const built = buildReceipt(recordArgs(world, makeReportsDir(defaultReports()), { harness: base, candidate: world.current }))
  assert.equal(built.ok, true, built.receipt.reason)
  assert.notEqual(built.receipt.candidateSha, built.receipt.harnessSha)
  assert.notEqual(built.receipt.harnessSha, built.receipt.sourceHeadSha)
})

/* ------------------------------------------------------------------------- *
 * CLI
 * ------------------------------------------------------------------------- */

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_REPOSITORY: "", GITHUB_RUN_ID: "", GITHUB_RUN_ATTEMPT: "", GITHUB_SHA: "", GITHUB_OUTPUT: "", ...env },
  })
}

test("CLI plan writes plan.json and GITHUB_OUTPUT on an unusable baseline", () => {
  const world = createPlanWorld()
  const output = path.join(tmpDir("e2e-validation-cli-"), "plan.json")
  const githubOutput = path.join(tmpDir("e2e-validation-cli-"), "github-output")
  const result = runCli(
    [
      "plan",
      "--adapter",
      "opencode",
      "--root",
      world.root,
      "--host-dir",
      world.hostDir,
      "--delivery-report",
      writeDeliveryReport(),
      "--candidate",
      world.current,
      "--harness",
      world.current,
      "--source-head",
      PR_HEAD_SHA,
      "--output",
      output,
      "--force-full",
      "true",
    ],
    { GITHUB_REPOSITORY: REPOSITORY, GITHUB_RUN_ID: "777", GITHUB_OUTPUT: githubOutput },
  )
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /verification mode: full/u)
  const plan = JSON.parse(readFileSync(output, "utf8"))
  assert.equal(plan.mode, FULL_MODE)
  assert.equal(plan.candidateSha, world.current)
  assert.match(readFileSync(githubOutput, "utf8"), /^verification-mode=full$/mu)
})

test("CLI plan defaults to full when the GitHub repository is unknown", () => {
  const world = createPlanWorld()
  const output = path.join(tmpDir("e2e-validation-cli-"), "plan.json")
  const result = runCli([
    "plan",
    "--adapter",
    "opencode",
    "--root",
    world.root,
    "--host-dir",
    world.hostDir,
    "--delivery-report",
    writeDeliveryReport(),
    "--candidate",
    world.current,
    "--harness",
    world.current,
    "--source-head",
    PR_HEAD_SHA,
    "--output",
    output,
  ])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(readFileSync(output, "utf8")).mode, FULL_MODE)
})

test("CLI record writes a reusable baseline with the run identity from the environment", () => {
  const world = createPlanWorld()
  const output = path.join(tmpDir("e2e-validation-cli-"), "validation.json")
  const result = runCli(
    [
      "record",
      "--adapter",
      "opencode",
      "--root",
      world.root,
      "--host-dir",
      world.hostDir,
      "--reports-dir",
      makeReportsDir(defaultReports()),
      "--candidate",
      world.current,
      "--harness",
      world.current,
      "--source-head",
      PR_HEAD_SHA,
      "--output",
      output,
    ],
    { GITHUB_REPOSITORY: REPOSITORY, GITHUB_RUN_ID: String(RUN_ID), GITHUB_RUN_ATTEMPT: String(RUN_ATTEMPT), GITHUB_SHA: MERGE_SHA },
  )
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /reusable full baseline/u)
  const receipt = JSON.parse(readFileSync(output, "utf8"))
  assert.equal(receipt.kind, RECEIPT_KIND_FULL)
  assert.equal(receipt.runId, RUN_ID)
  assert.equal(receipt.runAttempt, RUN_ATTEMPT)
})

test("CLI record writes an incomplete record and exits 0 when evidence is missing", () => {
  const world = createPlanWorld()
  const output = path.join(tmpDir("e2e-validation-cli-"), "validation.json")
  const result = runCli(
    [
      "record",
      "--adapter",
      "opencode",
      "--root",
      world.root,
      "--host-dir",
      world.hostDir,
      "--reports-dir",
      tmpDir("e2e-validation-empty-reports-"),
      "--candidate",
      world.current,
      "--harness",
      world.current,
      "--source-head",
      PR_HEAD_SHA,
      "--output",
      output,
    ],
    { GITHUB_REPOSITORY: REPOSITORY, GITHUB_RUN_ID: String(RUN_ID), GITHUB_RUN_ATTEMPT: String(RUN_ATTEMPT) },
  )
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /non-reusable baseline/u)
  assert.equal(JSON.parse(readFileSync(output, "utf8")).kind, RECEIPT_KIND_INCOMPLETE)
})

test("CLI rejects unknown adapters and options as usage errors", () => {
  const bad = runCli(["plan", "--adapter", "vim", "--output", path.join(tmpDir("e2e-validation-cli-"), "plan.json")])
  assert.equal(bad.status, 2)
  assert.match(bad.stderr, /--adapter must be one of opencode, pi/u)

  const unknownOption = runCli(["record", "--output", "x.json", "--nope", "1"])
  assert.equal(unknownOption.status, 2)
  assert.match(unknownOption.stderr, /unknown option/u)

  const unknownCommand = runCli(["verify"])
  assert.equal(unknownCommand.status, 2)
  assert.match(unknownCommand.stderr, /expected plan or record/u)
  assert.equal(existsSync("x.json"), false)
})
