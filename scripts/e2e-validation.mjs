#!/usr/bin/env node
/**
 * Generic planner/recorder for the split real-host E2E gate (node only).
 *
 * The complete behaviour matrix runs in several real-host jobs. Deciding
 * whether a candidate may skip it is a separate, cheap question that only the
 * GitHub facts plus the pure comparisons in `e2e-inputs.mjs` can answer:
 *
 *   node scripts/e2e-validation.mjs plan \
 *     --adapter opencode|pi --root <gitroot> --host-dir <resolved host dir> \
 *     --delivery-report <targeted verification report> \
 *     --candidate <40-hex> --harness <40-hex checkout> --source-head <40-hex event head> \
 *     --output <plan.json> [--force-full true]
 *
 * `plan` writes `verification-mode=full|delivery` (plus a concise reason and
 * the reused baseline) to `$GITHUB_OUTPUT`, and a `plan.json` with the full
 * decision evidence. Anything it cannot prove — missing report, missing
 * artifact, expired artifact, stale attempt, changed host input, unreadable
 * Git object, unknown job/step — falls back to `full`. It never fails the gate
 * on a missing baseline.
 *
 *   node scripts/e2e-validation.mjs record \
 *     --adapter ... --root ... --host-dir ... --reports-dir ... \
 *     --candidate <40-hex> --harness <40-hex> --source-head <40-hex> \
 *     --output <validation.json>
 *
 * `record` accepts `--root` for symmetry with `plan`; it does not read the
 * repository, because the record is built from the reports, the resolved host
 * directory and the identity flags only.
 *
 * `plan` reads GitHub with the `gh` CLI and therefore needs a token with
 * `actions: read` (`GITHUB_TOKEN` or `GH_TOKEN`); `GITHUB_REPOSITORY`,
 * `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT` and `GITHUB_OUTPUT` are
 * read from the environment when present.
 *
 * `record` turns this run's real group reports into the baseline artifact
 * (`e2e-full-validation` / `validation.json`). Only a complete matrix with four
 * `status: "ok"`, `scope: "full"` reports, one matching host input and one
 * identical complete delivery input set produces `kind: "full"`. Any missing or
 * inconsistent evidence produces `kind: "incomplete"` with a reason and exit 0:
 * a best-effort record must never hide a real E2E failure and must never
 * manufacture a reusable baseline.
 *
 * Run identity binding: sourceHeadSha matches the immutable run.head_sha;
 * harnessSha independently records the actual checkout (a merge checkout on
 * pull_request). Current pull_requests payload fields are not historical input.
 * The receipt run/attempt and candidate installation are checked separately.
 *
 * Both commands are generic: `ADAPTER_SPECS` only changes the required groups,
 * the expected workflow path, the expected job names and the accepted step
 * names. Nothing here installs a host, starts OpenCode/Pi, or duplicates a Core
 * business algorithm; the GitHub executor is injectable so unit tests never
 * touch the network.
 *
 * Evidence limits (deliberate, see docs/e2e-input-reuse.md):
 * - Only the newest `BASELINE_SEARCH_LIMIT` successful runs of this repository
 *   are searched, and only the artifact of the latest attempt of a run counts.
 * - A stored artifact is not the source of truth: the run, its attempt, its
 *   jobs/steps, its triggering commit and the host input are re-read before
 *   reuse.
 * - Host input never carries new required fields here; evidence that the parent
 *   adds inside `deliveryInputs` (for example a host executable digest) is
 *   compared as one opaque deep-equality object.
 * - A `delivery` record is never a baseline; `checkFullBaseline` rejects any
 *   record that is not one complete `kind: "full"` matrix of this repository.
 */
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { isDeepStrictEqual } from "node:util"

import {
  DELIVERY_VERDICT,
  FULL_VERDICT,
  OPENCODE_REQUIRED_GROUPS,
  PI_REQUIRED_GROUPS,
  checkFullBaseline,
  compareGitInputs,
  compareHostInputs,
  digestHostLock,
} from "./e2e-inputs.mjs"

/** Verification modes written to `GITHUB_OUTPUT` and `plan.json`. */
export const FULL_MODE = FULL_VERDICT
export const DELIVERY_MODE = DELIVERY_VERDICT

/** Baseline artifact contract (only a full run may upload or reuse it). */
export const BASELINE_ARTIFACT_NAME = "e2e-full-validation"
export const BASELINE_FILE_NAME = "validation.json"
export const RECEIPT_SCHEMA_VERSION = 1
export const RECEIPT_KIND_FULL = "full"
export const RECEIPT_KIND_INCOMPLETE = "incomplete"

/** Conservative bound on the previous-run search. */
export const BASELINE_SEARCH_LIMIT = 20

/** Files of the resolved host directory (`scripts/e2e-host.mjs resolve`). */
export const HOST_DIR_FILES = {
  manifest: "package.json",
  lock: "package-lock.json",
  input: "host-input.json",
}

const SHA_PATTERN = /^[0-9a-f]{40}$/u
const WORKFLOW_PATH = ".github/workflows/ci.yml"
const RUNS_PAGE_SIZE = 100

/**
 * Per-adapter facts. Job and step names must match the committed workflow
 * byte for byte: a rename makes every plan fall back to `full` instead of
 * silently accepting a job that did not run the real matrix.
 *
 * `steps` lists the accepted step names of a job; one of them must exist and
 * every step carrying an accepted name must have succeeded.
 */
export const ADAPTER_SPECS = Object.freeze({
  opencode: Object.freeze({
    adapter: "opencode",
    requiredGroups: OPENCODE_REQUIRED_GROUPS,
    workflowPath: WORKFLOW_PATH,
    jobs: Object.freeze([
      {
        name: "Real OpenCode latest E2E group A (host, models, management)",
        steps: ["Run real host E2E group A"],
      },
      {
        name: "Real OpenCode latest E2E group B (prices, last-known-good)",
        steps: ["Run real host E2E group B"],
      },
      {
        name: "Real OpenCode latest E2E group C (metadata, deletion repair)",
        steps: ["Run real host E2E group C"],
      },
      {
        name: "Real OpenCode latest E2E group D (notifications, failure recovery)",
        steps: ["Run real host E2E group D"],
      },
      // The required check itself: its success means the aggregate gate really
      // evaluated the four groups of this run.
      { name: "Real OpenCode latest E2E", steps: [] },
    ]),
  }),
  pi: Object.freeze({
    adapter: "pi",
    requiredGroups: PI_REQUIRED_GROUPS,
    workflowPath: WORKFLOW_PATH,
    jobs: Object.freeze([
      {
        name: "Real Pi latest E2E",
        steps: ["Run full real Pi host E2E"],
      },
    ]),
  }),
})

/**
 * The fixed install/run configuration that describes how host input was
 * produced. It must not contain mutable values (SHAs, temp dirs, run ids); the
 * workflow and this script are part of the harness Git comparison, so any
 * change here is already a `full` input change.
 */
export function fixedConfig(adapter) {
  return {
    adapter,
    hostInstall: adapter === "pi" ? "private-prefix-npm-install" : "private-prefix-npm-ci",
    pluginInstall: "real-host",
    hostResolution: "npm-view-latest-exact",
    e2eReport: "E2E_TIMING_FILE",
  }
}

export function adapterSpec(adapter) {
  return Object.prototype.hasOwnProperty.call(ADAPTER_SPECS, adapter) ? ADAPTER_SPECS[adapter] : null
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function isSha(value) {
  return typeof value === "string" && SHA_PATTERN.test(value)
}

function singleLine(value) {
  return String(value ?? "")
    .replace(/[\r\n]+/gu, " ")
    .trim()
}

function basename(file) {
  return path.basename(String(file ?? ""))
}

function readJsonFile(file, label = basename(file)) {
  if (typeof file !== "string" || file.trim() === "") return { ok: false, reason: `${label} path is missing` }
  if (!existsSync(file)) return { ok: false, reason: `${label} is missing` }
  let text
  try {
    text = readFileSync(file, "utf8")
  } catch (error) {
    return { ok: false, reason: `${label} cannot be read: ${singleLine(error.message)}` }
  }
  try {
    return { ok: true, json: JSON.parse(text) }
  } catch {
    return { ok: false, reason: `${label} is not valid JSON` }
  }
}

function writeJsonFile(file, value) {
  const target = path.resolve(file)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`)
  return target
}

/* ------------------------------------------------------------------------- *
 * Host input, delivery report and group reports
 * ------------------------------------------------------------------------- */

function readJsonWithBytes(file, label) {
  if (typeof file !== "string" || file.trim() === "" || !existsSync(file)) {
    return { ok: false, reason: `${label} is missing` }
  }
  let text
  try {
    text = readFileSync(file, "utf8")
  } catch (error) {
    return { ok: false, reason: `${label} cannot be read: ${singleLine(error.message)}` }
  }
  return { ok: true, text }
}

/**
 * Read the resolved host directory: the two lock files (their bytes decide the
 * lock digest) and the real `host-input.json` of this run.
 */
export function readHostEvidence({ adapter, hostDir }) {
  const spec = adapterSpec(adapter)
  if (!spec) return { ok: false, reason: `unknown adapter ${JSON.stringify(adapter)}` }
  if (typeof hostDir !== "string" || hostDir.trim() === "") {
    return { ok: false, reason: "the resolved host directory is missing" }
  }
  const manifest = readJsonWithBytes(path.join(hostDir, HOST_DIR_FILES.manifest), HOST_DIR_FILES.manifest)
  const lock = readJsonWithBytes(path.join(hostDir, HOST_DIR_FILES.lock), HOST_DIR_FILES.lock)
  const input = readJsonFile(path.join(hostDir, HOST_DIR_FILES.input), HOST_DIR_FILES.input)
  const failures = []
  for (const read of [manifest, lock, input]) if (!read.ok) failures.push(read.reason)
  if (failures.length > 0) return { ok: false, reason: failures.join("; ") }
  if (!isPlainObject(input.json)) return { ok: false, reason: `${HOST_DIR_FILES.input} is not an object` }

  let lockDigest
  try {
    lockDigest = digestHostLock({ packageJson: manifest.text, packageLock: lock.text })
  } catch (error) {
    return { ok: false, reason: `the host lock cannot be digested: ${singleLine(error.message)}` }
  }
  return {
    ok: true,
    evidence: {
      hostInput: input.json,
      lockDigest,
      config: fixedConfig(spec.adapter),
    },
    summary: {
      hostPackage: input.json.hostPackage ?? null,
      hostVersion: input.json.hostVersion ?? null,
      node: input.json.node ?? null,
      npm: input.json.npm ?? null,
      lockDigest,
    },
  }
}

/**
 * Read the targeted verification report of the current candidate. Reuse is
 * only considered when that report says the targeted delivery verification
 * itself succeeded on a complete runtime dependency input.
 */
export function readDeliveryReport({ file }) {
  const read = readJsonFile(file, "the delivery verification report")
  if (!read.ok) return read
  const report = read.json
  if (!isPlainObject(report)) return { ok: false, reason: "the delivery verification report is not an object" }
  const failures = []
  if (report.status !== "ok") failures.push(`its status is ${JSON.stringify(report.status)}, expected "ok"`)
  if (report.scope !== "delivery") failures.push(`its scope is ${JSON.stringify(report.scope)}, expected "delivery"`)
  if (!isPlainObject(report.deliveryInputs)) failures.push("it has no deliveryInputs object")
  else if (report.deliveryInputs.complete !== true) failures.push("its deliveryInputs are not complete")
  if (!isPlainObject(report.hostInput)) failures.push("it has no hostInput object")
  if (failures.length > 0) return { ok: false, reason: `the delivery verification report is not usable: ${failures.join("; ")}` }
  return {
    ok: true,
    evidence: {
      scope: report.scope,
      status: report.status,
      hostInput: report.hostInput,
      deliveryInputs: report.deliveryInputs,
    },
  }
}

function walkJsonFiles(dir) {
  const files = []
  const visit = (current) => {
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) files.push(full)
    }
  }
  visit(dir)
  return files.sort()
}

function looksLikeE2eReport(json) {
  return isPlainObject(json) && ("group" in json || "scope" in json || "status" in json)
}

/**
 * Collect the real group reports of this run. Files that are not reports are
 * ignored (an artifact directory may hold other JSON); anything that looks like
 * a report but is inconsistent becomes a recorded failure, never a silent pass.
 */
export function collectGroupReports({ reportsDir, requiredGroups }) {
  if (typeof reportsDir !== "string" || reportsDir.trim() === "") {
    return { ok: false, reason: "the reports directory is missing", reports: new Map(), ignored: [] }
  }
  if (!existsSync(reportsDir)) {
    return { ok: false, reason: "the reports directory does not exist", reports: new Map(), ignored: [] }
  }
  const reports = new Map()
  const ignored = []
  const failures = []
  for (const file of walkJsonFiles(reportsDir)) {
    const relative = path.relative(path.resolve(reportsDir), file)
    const read = readJsonFile(file, relative)
    if (!read.ok) {
      failures.push(`${relative}: ${read.reason}`)
      continue
    }
    if (!looksLikeE2eReport(read.json)) {
      ignored.push(relative)
      continue
    }
    const report = read.json
    if (typeof report.group !== "string" || report.group.trim() === "") {
      failures.push(`${relative}: the report has no group id`)
      continue
    }
    if (!requiredGroups.includes(report.group)) {
      failures.push(`${relative}: unexpected group ${JSON.stringify(report.group)}`)
      continue
    }
    if (reports.has(report.group)) {
      failures.push(`group ${report.group} has more than one report (${reports.get(report.group).file}, ${relative})`)
      continue
    }
    reports.set(report.group, { ...report, file: relative })
  }
  return { ok: failures.length === 0, reason: failures.join("; "), reports, ignored, failures }
}

/* ------------------------------------------------------------------------- *
 * Git object availability
 * ------------------------------------------------------------------------- */

function runGit({ root, args }) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C", GIT_PAGER: "cat" },
  })
  return {
    ok: result.error === undefined && result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  }
}

function commitPresent({ root, sha }) {
  return runGit({ root, args: ["cat-file", "-e", `${sha}^{commit}`] }).ok
}

/**
 * Make sure a baseline commit is available locally; fetch it from the current
 * origin when the shallow PR checkout does not contain it. Nothing else is
 * fetched and no branch is created.
 */
export function ensureCommit({ root, sha }) {
  if (!isSha(sha)) return { ok: false, reason: `${JSON.stringify(sha)} is not a full 40-character lowercase commit SHA` }
  if (typeof root !== "string" || root.trim() === "") return { ok: false, reason: "the repository root is missing" }
  if (commitPresent({ root, sha })) return { ok: true, fetched: false }
  const fetched = runGit({ root, args: ["fetch", "--no-tags", "--quiet", "origin", sha] })
  if (!fetched.ok) {
    const detail = fetched.error ? fetched.error.message : singleLine(fetched.stderr) || `git exited with ${fetched.status}`
    return { ok: false, reason: `commit ${sha} is not available locally and could not be fetched from origin: ${detail}` }
  }
  if (!commitPresent({ root, sha })) return { ok: false, reason: `origin did not provide commit ${sha}` }
  return { ok: true, fetched: true }
}

/* ------------------------------------------------------------------------- *
 * GitHub facts (injectable; production uses the `gh` CLI)
 * ------------------------------------------------------------------------- */

function gh(args) {
  const result = spawnSync("gh", args, { encoding: "utf8", maxBuffer: RUNS_PAGE_SIZE * 1024 * 1024, env: process.env })
  if (result.error) return { ok: false, reason: `gh ${args.slice(0, 2).join(" ")} failed: ${singleLine(result.error.message)}` }
  if (result.status !== 0) {
    const detail = singleLine(result.stderr) || `exit code ${result.status}`
    return { ok: false, reason: `gh ${args.slice(0, 2).join(" ")} failed: ${detail}` }
  }
  return { ok: true, stdout: result.stdout ?? "" }
}

function ghJson(args) {
  const result = gh(args)
  if (!result.ok) return result
  try {
    return { ok: true, json: JSON.parse(result.stdout === "" ? "null" : result.stdout) }
  } catch {
    return { ok: false, reason: `gh ${args.slice(0, 2).join(" ")} did not return JSON` }
  }
}

function jsonArray(result, key, label) {
  if (!result.ok) return result
  const value = key ? result.json?.[key] : result.json
  if (!Array.isArray(value)) return { ok: false, reason: `${label} did not return a JSON array` }
  return { ok: true, items: value }
}

/**
 * Default executor: read-only `gh` CLI calls plus `gh run download` for the
 * baseline artifact. Each method returns `{ ok, ... }` and never throws.
 */
export function createGithubExecutor() {
  return {
    listSuccessfulRuns({ repository, limit }) {
      const result = ghJson(["api", `repos/${repository}/actions/runs?status=success&per_page=${limit}`])
      const parsed = jsonArray(result, "workflow_runs", "the workflow run list")
      return parsed.ok ? { ok: true, runs: parsed.items } : parsed
    },
    getRun({ repository, runId }) {
      const result = ghJson(["api", `repos/${repository}/actions/runs/${runId}`])
      if (!result.ok) return result
      if (!isPlainObject(result.json)) return { ok: false, reason: `run ${runId} was not returned as an object` }
      return { ok: true, run: result.json }
    },
    listArtifacts({ repository, runId }) {
      const result = ghJson(["api", `repos/${repository}/actions/runs/${runId}/artifacts?per_page=${RUNS_PAGE_SIZE}`])
      const parsed = jsonArray(result, "artifacts", `the artifact list of run ${runId}`)
      return parsed.ok ? { ok: true, artifacts: parsed.items, complete: parsed.items.length < RUNS_PAGE_SIZE } : parsed
    },
    downloadArtifact({ repository, runId, name, dir }) {
      mkdirSync(dir, { recursive: true })
      const result = gh(["run", "download", String(runId), "--repo", repository, "--name", name, "--dir", dir])
      return result.ok ? { ok: true } : result
    },
    listJobs({ repository, runId, attempt }) {
      const result = ghJson(["api", `repos/${repository}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=${RUNS_PAGE_SIZE}`])
      const parsed = jsonArray(result, "jobs", `the job list of run ${runId} attempt ${attempt}`)
      return parsed.ok ? { ok: true, jobs: parsed.items, complete: parsed.items.length < RUNS_PAGE_SIZE } : parsed
    },
  }
}

/* ------------------------------------------------------------------------- *
 * Run/job/step facts
 * ------------------------------------------------------------------------- */

/** Bind the triggering commit using the run's immutable head_sha.
 * GITHUB_SHA on pull_request is a synthetic merge checkout, recorded separately
 * as harnessSha. The current pull_requests payload is not a historical input.
 */
export function runSourceHead(run) {
  const sha = run?.head_sha
  if (!isSha(sha)) return { ok: false, reason: "the run source head is not a full commit SHA" }
  return { ok: true, sha }
}

function checkRunFacts({ spec, repository, run }) {
  const failures = []
  if (!isPlainObject(run)) return { ok: false, failures: ["the run could not be read"] }
  if (run.status !== "completed") failures.push(`its status is ${JSON.stringify(run.status)}, expected "completed"`)
  if (run.conclusion !== "success") failures.push(`its conclusion is ${JSON.stringify(run.conclusion)}, expected "success"`)
  if (run.path !== spec.workflowPath) failures.push(`its workflow path is ${JSON.stringify(run.path)}, expected ${JSON.stringify(spec.workflowPath)}`)
  if (run.head_repository?.full_name !== repository) {
    failures.push(`its head repository is ${JSON.stringify(run.head_repository?.full_name ?? null)}, expected ${JSON.stringify(repository)}`)
  }
  if (!isPositiveInteger(run.run_attempt)) failures.push(`its run_attempt ${JSON.stringify(run.run_attempt)} is not a positive integer`)
  return { ok: failures.length === 0, failures }
}

function checkJobFacts({ spec, jobs }) {
  const failures = []
  if (!Array.isArray(jobs) || jobs.length === 0) return { ok: false, failures: ["the run has no jobs"] }
  for (const required of spec.jobs) {
    const matches = jobs.filter((job) => job?.name === required.name)
    if (matches.length === 0) {
      failures.push(`the required job ${JSON.stringify(required.name)} did not run`)
      continue
    }
    if (matches.length > 1) {
      failures.push(`the required job ${JSON.stringify(required.name)} appears ${matches.length} times`)
      continue
    }
    const job = matches[0]
    if (job.status !== "completed") failures.push(`job ${JSON.stringify(required.name)} has status ${JSON.stringify(job.status)}`)
    else if (job.conclusion !== "success") {
      failures.push(`job ${JSON.stringify(required.name)} concluded ${JSON.stringify(job.conclusion)}, expected "success"`)
    }
    if (required.steps.length === 0) continue
    const steps = Array.isArray(job.steps) ? job.steps : []
    const accepted = new Set(required.steps)
    const stepMatches = steps.filter((step) => accepted.has(step?.name))
    if (stepMatches.length === 0) {
      failures.push(`job ${JSON.stringify(required.name)} has none of the required steps ${required.steps.map((name) => JSON.stringify(name)).join(", ")}`)
      continue
    }
    for (const step of stepMatches) {
      if (step.status !== "completed") failures.push(`step ${JSON.stringify(step.name)} of job ${JSON.stringify(required.name)} has status ${JSON.stringify(step.status)}`)
      else if (step.conclusion !== "success") {
        failures.push(`step ${JSON.stringify(step.name)} of job ${JSON.stringify(required.name)} concluded ${JSON.stringify(step.conclusion)}, expected "success"`)
      }
    }
  }
  return { ok: failures.length === 0, failures }
}

/* ------------------------------------------------------------------------- *
 * Baseline search
 * ------------------------------------------------------------------------- */

function findBaselineFile(dir) {
  const file = path.join(dir, BASELINE_FILE_NAME)
  return existsSync(file) ? file : null
}

function normalizeDeliveryInputs(value) {
  if (!isPlainObject(value) || value.complete !== true) return null
  return value
}

/**
 * A host input that recorded the installed candidate must name exactly that
 * candidate. Missing/null is tolerated (the candidate identity is compared by
 * the Git tree checks); anything else is a public reason to run everything.
 */
function candidateBindingProblem({ hostInput, candidate, label }) {
  const recorded = hostInput?.candidateSha
  if (recorded === undefined || recorded === null) return null
  if (typeof recorded !== "string" || recorded.trim() === "") return `${label} recorded an unusable candidateSha ${JSON.stringify(recorded)}`
  if (recorded !== candidate) return `${label} installed candidate ${recorded}, not ${candidate}`
  return null
}

/**
 * Re-read one candidate run and decide whether its artifact may back a reuse.
 * Every check is intentionally independent: the receipt's own claims are
 * re-verified against the run, its attempt, its jobs and steps, the source
 * head, the host input and the two Git trees.
 */
function evaluateRun({ spec, repository, root, candidate, harness, hostEvidence, deliveryReport, github, runSummary }) {
  const runId = runSummary?.id
  if (!isPositiveInteger(runId)) return { ok: false, reason: "the listed run has no usable id" }

  const runRead = github.getRun({ repository, runId })
  if (!runRead.ok) return { ok: false, reason: runRead.reason ?? `run ${runId} could not be read` }
  const run = runRead.run
  const facts = checkRunFacts({ spec, repository, run })
  if (!facts.ok) return { ok: false, reason: facts.failures.join("; ") }

  const sourceHeadRead = runSourceHead(run)
  if (!sourceHeadRead.ok) return { ok: false, reason: sourceHeadRead.reason }

  const artifactRead = github.listArtifacts({ repository, runId })
  if (!artifactRead.ok) return { ok: false, reason: artifactRead.reason ?? `the artifacts of run ${runId} could not be listed` }
  if (artifactRead.complete === false) return { ok: false, reason: `run ${runId} has too many artifacts to verify` }
  const artifact = (artifactRead.artifacts ?? []).find((entry) => entry?.name === BASELINE_ARTIFACT_NAME)
  if (!artifact) return { ok: false, reason: `run ${runId} has no ${BASELINE_ARTIFACT_NAME} artifact` }
  if (artifact.expired === true) return { ok: false, reason: `the ${BASELINE_ARTIFACT_NAME} artifact of run ${runId} has expired` }

  const dir = mkdtempSync(path.join(os.tmpdir(), "e2e-validation-baseline-"))
  try {
    const downloaded = github.downloadArtifact({ repository, runId, name: BASELINE_ARTIFACT_NAME, dir })
    if (!downloaded.ok) return { ok: false, reason: downloaded.reason ?? `the artifact of run ${runId} could not be downloaded` }
    const file = findBaselineFile(dir)
    if (!file) return { ok: false, reason: `the artifact of run ${runId} does not contain ${BASELINE_FILE_NAME}` }
    const receiptRead = readJsonFile(file, BASELINE_FILE_NAME)
    if (!receiptRead.ok) return { ok: false, reason: `the baseline record of run ${runId} is unusable: ${receiptRead.reason}` }
    return evaluateReceipt({ spec, repository, root, candidate, harness, hostEvidence, deliveryReport, github, run, sourceHeadSha: sourceHeadRead.sha, receipt: receiptRead.json })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function evaluateReceipt({ spec, repository, root, candidate, harness, hostEvidence, deliveryReport, github, run, sourceHeadSha, receipt }) {
  const runId = run.id
  const baseline = checkFullBaseline({ baseline: receipt, repository, requiredGroups: spec.requiredGroups })
  if (!baseline.ok) return { ok: false, reason: `the baseline record of run ${runId} is not a complete matrix: ${baseline.failures.join("; ")}` }

  // The record must describe this run, not a different one that happens to sit
  // in the searched window. Both facts below are immutable per run.
  if (receipt.runId !== runId) {
    return { ok: false, reason: `the baseline record belongs to run ${JSON.stringify(receipt.runId)}, but was downloaded from run ${runId}` }
  }

  // A re-run gets a new attempt; an artifact uploaded by an older attempt must
  // not be mistaken for the result of the current one.
  if (receipt.runAttempt !== run.run_attempt) {
    return { ok: false, reason: `the baseline record is attempt ${receipt.runAttempt}, but run ${runId} is now at attempt ${run.run_attempt}` }
  }
  if (receipt.sourceHeadSha !== sourceHeadSha) {
    return { ok: false, reason: `the baseline record claims source head ${receipt.sourceHeadSha}, but the run's source head is ${sourceHeadSha}` }
  }
  if (!isPlainObject(receipt.host) || !isPlainObject(receipt.host.hostInput)) {
    return { ok: false, reason: "the baseline record carries no host input" }
  }
  const baselineCandidateProblem = candidateBindingProblem({
    hostInput: receipt.host.hostInput,
    candidate: receipt.candidateSha,
    label: "the baseline host input",
  })
  if (baselineCandidateProblem) return { ok: false, reason: baselineCandidateProblem }

  const jobsRead = github.listJobs({ repository, runId, attempt: run.run_attempt })
  if (!jobsRead.ok) return { ok: false, reason: jobsRead.reason ?? `the jobs of run ${runId} could not be listed` }
  if (jobsRead.complete === false) return { ok: false, reason: `run ${runId} has too many jobs to verify` }
  const jobFacts = checkJobFacts({ spec, jobs: jobsRead.jobs })
  if (!jobFacts.ok) return { ok: false, reason: `run ${runId} did not complete the full matrix: ${jobFacts.failures.join("; ")}` }

  const commits = [receipt.candidateSha, receipt.harnessSha].map((sha) => ({ sha, read: ensureCommit({ root, sha }) }))
  for (const { sha, read } of commits) {
    if (!read.ok) return { ok: false, reason: read.reason ?? `commit ${sha} is not available` }
  }

  const git = compareGitInputs({
    root,
    baselineCandidate: receipt.candidateSha,
    candidate,
    baselineHarness: receipt.harnessSha,
    harness,
  })
  if (git.verdict !== DELIVERY_MODE) return { ok: false, reason: `the Git inputs differ from the baseline: ${git.reason}` }

  const baselineDeliveryInputs = normalizeDeliveryInputs(receipt.deliveryInputs)
  if (!baselineDeliveryInputs) {
    return { ok: false, reason: "the baseline record carries no complete deliveryInputs, so its runtime dependencies are unknown" }
  }
  const host = compareHostInputs({ baseline: receipt.host, current: hostEvidence })
  if (host.verdict !== DELIVERY_MODE) return { ok: false, reason: `the host input differs from the baseline: ${host.reason}` }

  const currentDeliveryInputs = normalizeDeliveryInputs(deliveryReport.deliveryInputs)
  if (!currentDeliveryInputs) return { ok: false, reason: "the current delivery verification has no complete deliveryInputs" }
  if (!isDeepStrictEqual(currentDeliveryInputs, baselineDeliveryInputs)) {
    return { ok: false, reason: "the current runtime dependency evidence differs from the baseline" }
  }

  return {
    ok: true,
    baseline: { runId, runAttempt: run.run_attempt, url: typeof run.html_url === "string" ? run.html_url : null },
    evidence: {
      sourceHeadSha,
      jobs: spec.jobs.map((job) => job.name),
      git: {
        candidate: git.candidate.changedPaths.map((change) => `${change.status} ${change.path}`),
        harness: git.harness.changedPaths.map((change) => `${change.status} ${change.path}`),
      },
      host: host.compared,
      deliveryInputs: currentDeliveryInputs,
    },
  }
}

export function findReusableBaseline({ spec, repository, root, candidate, harness, hostEvidence, deliveryReport, github, currentRunId, limit = BASELINE_SEARCH_LIMIT }) {
  if (typeof repository !== "string" || !/^[\w.-]+\/[\w.-]+$/u.test(repository)) {
    return { ok: false, reason: `the repository ${JSON.stringify(repository ?? null)} is not owner/name` }
  }
  const listed = github.listSuccessfulRuns({ repository, limit })
  if (!listed.ok) return { ok: false, reason: listed.reason ?? "the successful workflow runs could not be listed" }
  // The newest `limit` successes are the whole search window; exactly `limit`
  // entries simply means the window is full, not that the list is truncated.
  const runs = Array.isArray(listed.runs) ? listed.runs.slice(0, limit) : []
  if (runs.length === 0) return { ok: false, reason: "this repository has no previous successful workflow run" }

  const rejections = []
  for (const runSummary of runs) {
    if (isPositiveInteger(currentRunId) && runSummary?.id === currentRunId) continue
    const evaluated = evaluateRun({ spec, repository, root, candidate, harness, hostEvidence, deliveryReport, github, runSummary })
    if (evaluated.ok) return evaluated
    rejections.push(`run ${runSummary?.id}: ${evaluated.reason}`)
  }
  const shown = rejections.slice(0, 3)
  const prefix = rejections.length === 0 ? "no previous run other than this one could be searched" : `${rejections.length} previous successful run(s) did not qualify`
  return { ok: false, reason: `${prefix}: ${shown.join(" | ")}` }
}

/* ------------------------------------------------------------------------- *
 * plan
 * ------------------------------------------------------------------------- */

function planShell({ candidate, harness, sourceHead }) {
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    mode: FULL_MODE,
    candidateSha: isSha(candidate) ? candidate : null,
    harnessSha: isSha(harness) ? harness : null,
    sourceHeadSha: isSha(sourceHead) ? sourceHead : null,
  }
}

/**
 * Decide the verification mode of this candidate. Every failure degrades to
 * `full` with a public reason; the caller never has to fail the job because a
 * baseline was missing or unreadable.
 */
export function decidePlan({
  adapter,
  root,
  hostDir,
  deliveryReport,
  candidate,
  harness,
  sourceHead,
  forceFull = false,
  repository,
  currentRunId = null,
  github = null,
  limit = BASELINE_SEARCH_LIMIT,
}) {
  const spec = adapterSpec(adapter)
  const base = planShell({ candidate, harness, sourceHead })
  const full = (reason, evidence = {}) => ({ mode: FULL_MODE, reason, plan: { ...base, mode: FULL_MODE, reason, evidence } })

  if (!spec) return full(`unknown adapter ${JSON.stringify(adapter)}`)
  if (forceFull) return full("full verification was requested explicitly")

  for (const [label, value] of [["candidate", candidate], ["harness", harness], ["source-head", sourceHead]]) {
    if (!isSha(value)) return full(`the ${label} must be a full 40-character lowercase commit SHA, got ${JSON.stringify(value ?? null)}`)
  }
  if (typeof root !== "string" || root.trim() === "") return full("the Git repository root is missing")

  const reportRead = readDeliveryReport({ file: deliveryReport })
  if (!reportRead.ok) return full(reportRead.reason)

  const hostRead = readHostEvidence({ adapter, hostDir })
  if (!hostRead.ok) return full(hostRead.reason)

  const hostCandidateProblem = candidateBindingProblem({ hostInput: hostRead.evidence.hostInput, candidate, label: "the resolved host input" })
  if (hostCandidateProblem) return full(hostCandidateProblem)
  const reportCandidateProblem = candidateBindingProblem({
    hostInput: reportRead.evidence.hostInput,
    candidate,
    label: "the delivery verification",
  })
  if (reportCandidateProblem) return full(reportCandidateProblem)

  const reportHost = compareHostInputs({
    baseline: hostRead.evidence,
    current: { hostInput: reportRead.evidence.hostInput, lockDigest: hostRead.evidence.lockDigest, config: hostRead.evidence.config },
  })
  if (reportHost.verdict !== DELIVERY_MODE) {
    return full(`the delivery verification was produced against a different host input: ${reportHost.reason}`)
  }

  const executor = github ?? createGithubExecutor()
  const found = findReusableBaseline({
    spec,
    repository,
    root,
    candidate,
    harness,
    hostEvidence: hostRead.evidence,
    deliveryReport: reportRead.evidence,
    github: executor,
    currentRunId,
    limit,
  })
  const evidence = {
    deliveryReport: { scope: reportRead.evidence.scope, status: reportRead.evidence.status, complete: reportRead.evidence.deliveryInputs.complete },
    host: hostRead.summary,
    config: hostRead.evidence.config,
  }
  if (!found.ok) return full(found.reason, evidence)
  return {
    mode: DELIVERY_MODE,
    reason: `the complete real-host matrix of run ${found.baseline.runId} attempt ${found.baseline.runAttempt} already covers this input`,
    plan: { ...base, mode: DELIVERY_MODE, reason: `reusing the complete matrix of run ${found.baseline.runId} attempt ${found.baseline.runAttempt}`, baseline: found.baseline, evidence: { ...evidence, ...found.evidence } },
  }
}

export function planOutputs({ decision }) {
  const outputs = {
    "verification-mode": decision.mode,
    "verification-reason": decision.reason,
  }
  outputs["verification-baseline"] = decision.plan.baseline
    ? `${decision.plan.baseline.runId}/${decision.plan.baseline.runAttempt}`
    : "none"
  return outputs
}

/**
 * Append `key=value` outputs in the documented `GITHUB_OUTPUT` file format.
 * Values are single-line; a missing file (local runs) is not an error.
 */
export function writeGithubOutput({ file, values }) {
  if (typeof file !== "string" || file.trim() === "") return { ok: true, written: false }
  const lines = Object.entries(values).map(([key, value]) => `${key}=${singleLine(value).slice(0, 900)}`)
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  appendFileSync(file, `${lines.join("\n")}\n`)
  return { ok: true, written: true }
}

/* ------------------------------------------------------------------------- *
 * record
 * ------------------------------------------------------------------------- */

function incompleteReceipt({ adapter, candidate, harness, sourceHead, reason, groups = {}, ignored = [] }) {
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    kind: RECEIPT_KIND_INCOMPLETE,
    adapter: adapter ?? null,
    candidateSha: isSha(candidate) ? candidate : null,
    harnessSha: isSha(harness) ? harness : null,
    sourceHeadSha: isSha(sourceHead) ? sourceHead : null,
    groups,
    reason,
    ignoredReports: ignored,
  }
}

/**
 * Build the baseline record of this run from its real group reports.
 *
 * `kind: "full"` requires: every required group reported exactly once with
 * `status: "ok"` and `scope: "full"`, a host input that matches the resolved
 * host directory, and one identical complete `deliveryInputs` object in every
 * report. Anything else is an `incomplete` record with a reason: reuse is
 * closed, the run is not failed.
 */
export function buildReceipt({
  adapter,
  hostDir,
  reportsDir,
  candidate,
  harness,
  sourceHead,
  repository,
  runId,
  runAttempt,
}) {
  const spec = adapterSpec(adapter)
  const failures = []
  if (!spec) failures.push(`unknown adapter ${JSON.stringify(adapter)}`)
  for (const [label, value] of [
    ["candidate", candidate],
    ["harness", harness],
    ["source-head", sourceHead],
  ]) {
    if (!isSha(value)) failures.push(`the ${label} must be a full 40-character lowercase commit SHA, got ${JSON.stringify(value ?? null)}`)
  }
  if (typeof repository !== "string" || !/^[\w.-]+\/[\w.-]+$/u.test(repository)) failures.push(`the repository ${JSON.stringify(repository ?? null)} is not owner/name`)
  if (!isPositiveInteger(runId)) failures.push(`the run id ${JSON.stringify(runId)} is not a positive integer`)
  if (!isPositiveInteger(runAttempt)) failures.push(`the run attempt ${JSON.stringify(runAttempt)} is not a positive integer`)

  const hostRead = readHostEvidence({ adapter, hostDir })
  if (!hostRead.ok) failures.push(hostRead.reason)
  else {
    const hostCandidateProblem = candidateBindingProblem({ hostInput: hostRead.evidence.hostInput, candidate, label: "the resolved host input" })
    if (hostCandidateProblem) failures.push(hostCandidateProblem)
  }
  const collected = spec ? collectGroupReports({ reportsDir, requiredGroups: spec.requiredGroups }) : { ok: false, reports: new Map(), ignored: [], failures: [] }
  if (spec && !collected.ok) failures.push(collected.reason)

  const observed = {}
  const groupEvidence = []
  const deliveryInputs = []
  if (spec) {
    for (const group of spec.requiredGroups) {
      const report = collected.reports?.get(group)
      if (!report) {
        failures.push(`group ${group} produced no report`)
        continue
      }
      observed[group] = { status: report.status ?? null, scope: report.scope ?? null }
      if (report.status !== "ok") failures.push(`group ${group} reported status ${JSON.stringify(report.status ?? null)}, expected "ok"`)
      if (report.scope !== "full") failures.push(`group ${group} reported scope ${JSON.stringify(report.scope ?? null)}, expected "full"`)
      if (!isPlainObject(report.hostInput)) {
        failures.push(`group ${group} reported no host input`)
      } else if (hostRead.ok) {
        const host = compareHostInputs({
          baseline: hostRead.evidence,
          current: { hostInput: report.hostInput, lockDigest: hostRead.evidence.lockDigest, config: hostRead.evidence.config },
        })
        if (host.verdict !== DELIVERY_MODE) failures.push(`group ${group} ran with a different host input: ${host.reason}`)
      }
      const complete = normalizeDeliveryInputs(report.deliveryInputs)
      if (!complete) failures.push(`group ${group} reported no complete deliveryInputs`)
      else deliveryInputs.push({ group, value: complete })
      groupEvidence.push({ group, status: report.status ?? null, scope: report.scope ?? null, file: report.file })
    }
    if (deliveryInputs.length > 0) {
      const [first, ...rest] = deliveryInputs
      for (const other of rest) {
        if (!isDeepStrictEqual(first.value, other.value)) {
          failures.push(`the deliveryInputs of group ${other.group} differ from group ${first.group}`)
        }
      }
    }
  }

  const identity = { adapter: spec?.adapter ?? adapter, candidate, harness, sourceHead }
  if (failures.length > 0) {
    return {
      ok: false,
      receipt: incompleteReceipt({ ...identity, reason: failures.join("; "), groups: observed, ignored: collected.ignored ?? [] }),
      failures,
    }
  }

  const groups = {}
  for (const group of spec.requiredGroups) groups[group] = "success"

  const receipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    kind: RECEIPT_KIND_FULL,
    adapter: spec.adapter,
    repository,
    runId,
    runAttempt,
    sourceHeadSha: sourceHead,
      harnessSha: harness,
    candidateSha: candidate,
    groups,
    host: {
      hostInput: hostRead.evidence.hostInput,
      lockDigest: hostRead.evidence.lockDigest,
      config: hostRead.evidence.config,
    },
    deliveryInputs: deliveryInputs[0].value,
    evidence: {
      groupReports: groupEvidence,
      ignoredReports: collected.ignored ?? [],
    },
  }
  return { ok: true, receipt, failures: [] }
}

/* ------------------------------------------------------------------------- *
 * CLI
 * ------------------------------------------------------------------------- */

export const PLAN_FLAGS = ["adapter", "root", "host-dir", "delivery-report", "candidate", "harness", "source-head", "output", "force-full"]
export const RECORD_FLAGS = ["adapter", "root", "host-dir", "reports-dir", "candidate", "harness", "source-head", "output"]

function usage(message) {
  const error = new Error(message)
  error.usage = true
  return error
}

function parseArgs({ argv, allowed }) {
  const [command, ...rest] = argv
  const options = {}
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]
    const value = rest[index + 1]
    if (typeof key !== "string" || !key.startsWith("--") || value === undefined) throw usage(`invalid argument ${JSON.stringify(key ?? null)}`)
    const name = key.slice(2)
    if (!allowed.includes(name)) throw usage(`unknown option ${JSON.stringify(key)}; expected one of ${allowed.map((flag) => `--${flag}`).join(", ")}`)
    options[name] = value
  }
  return { command, options }
}

function requireOption(options, name) {
  const value = options[name]
  if (typeof value !== "string" || value.trim() === "") throw usage(`--${name} is required`)
  return value
}

function positiveIntegerEnv(env, name) {
  const raw = env[name]
  if (raw === undefined || raw === "") return null
  const value = Number(raw)
  return isPositiveInteger(value) ? value : null
}

function runPlan(options, { env = process.env, github = null } = {}) {
  const adapter = requireOption(options, "adapter")
  if (!adapterSpec(adapter)) throw usage(`--adapter must be one of ${Object.keys(ADAPTER_SPECS).join(", ")}`)
  const output = requireOption(options, "output")
  const decision = decidePlan({
    adapter,
    root: requireOption(options, "root"),
    hostDir: requireOption(options, "host-dir"),
    deliveryReport: requireOption(options, "delivery-report"),
    candidate: requireOption(options, "candidate"),
    harness: requireOption(options, "harness"),
    sourceHead: requireOption(options, "source-head"),
    forceFull: String(options["force-full"] ?? "").toLowerCase() === "true",
    repository: env.GITHUB_REPOSITORY ?? null,
    currentRunId: positiveIntegerEnv(env, "GITHUB_RUN_ID"),
    github,
  })
  writeJsonFile(output, decision.plan)
  writeGithubOutput({ file: env.GITHUB_OUTPUT, values: planOutputs({ decision }) })
  console.log(`verification mode: ${decision.mode}`)
  console.log(`reason: ${singleLine(decision.reason)}`)
  if (decision.plan.baseline) console.log(`baseline: run ${decision.plan.baseline.runId} attempt ${decision.plan.baseline.runAttempt} ${decision.plan.baseline.url ?? ""}`.trimEnd())
  return 0
}

function runRecord(options, { env = process.env } = {}) {
  const adapter = requireOption(options, "adapter")
  if (!adapterSpec(adapter)) throw usage(`--adapter must be one of ${Object.keys(ADAPTER_SPECS).join(", ")}`)
  const output = requireOption(options, "output")
  const built = buildReceipt({
    adapter,
    hostDir: requireOption(options, "host-dir"),
    reportsDir: requireOption(options, "reports-dir"),
    candidate: requireOption(options, "candidate"),
    harness: requireOption(options, "harness"),
    sourceHead: requireOption(options, "source-head"),
    repository: env.GITHUB_REPOSITORY ?? null,
    runId: positiveIntegerEnv(env, "GITHUB_RUN_ID"),
    runAttempt: positiveIntegerEnv(env, "GITHUB_RUN_ATTEMPT"),
  })
  writeJsonFile(output, built.receipt)
  if (built.ok) {
    console.log(`recorded a reusable full baseline for groups ${Object.keys(built.receipt.groups).join(",")}`)
  } else {
    console.log(`recorded a non-reusable baseline (${built.receipt.kind})`)
    for (const failure of built.failures) console.log(`- ${singleLine(failure)}`)
  }
  return 0
}

export function main(argv, { env = process.env, github = null } = {}) {
  const command = argv[0]
  try {
    if (command === "plan") return runPlan(parseArgs({ argv, allowed: PLAN_FLAGS }).options, { env, github })
    if (command === "record") return runRecord(parseArgs({ argv, allowed: RECORD_FLAGS }).options, { env })
    throw usage(`unknown command ${JSON.stringify(command ?? null)}; expected plan or record`)
  } catch (error) {
    if (error?.usage) {
      console.error(`e2e-validation: ${error.message}`)
      return 2
    }
    console.error(`e2e-validation: ${error?.message ?? error}`)
    return 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
