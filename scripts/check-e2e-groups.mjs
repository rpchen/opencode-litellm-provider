#!/usr/bin/env node
/**
 * Completeness gate for the split real-host E2E gate.
 *
 * The single required status check is the aggregate job `Real OpenCode latest
 * E2E`. It must only succeed when the resolve job and all four fixed group jobs
 * really succeeded in this run. GitHub reports a job that was skipped, cancelled
 * or never started as something other than "success" (or omits it entirely), so
 * every required result is checked strictly and by fixed job id.
 *
 * Usage (aggregate job):
 *   E2E_GROUP_RESULTS='{"resolve-host":{"result":"success"},...}' \
 *   E2E_GATE_MODE=groups node scripts/check-e2e-groups.mjs
 *
 * Options:
 *   --results <file>   read the needs payload from a file instead of the env
 *   --mode <mode>      groups | serial-baseline (default: groups)
 *
 * `serial-baseline` is a manual benchmark mode: the four groups do not run, so
 * this gate must never report the full-group gate as satisfied. It fails with an
 * explicit message so a benchmark run can never be mistaken for a green gate.
 */

import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const E2E_GROUPS = ["A", "B", "C", "D"]

/** Fixed job ids. Renaming a job here without updating the workflow breaks the gate. */
export const GATE_JOBS = [
  { job: "resolve-host", label: "resolve the host input" },
  ...E2E_GROUPS.map((group) => ({ job: `e2e-group-${group.toLowerCase()}`, group, label: `group ${group}` })),
]

export const GATE_MODES = ["groups", "serial-baseline"]

/**
 * Evaluate the aggregate payload (`toJSON(needs)`).
 * Returns a verdict object rather than exiting so it can be unit tested.
 */
export function evaluateGate({ results, mode = "groups" } = {}) {
  if (!GATE_MODES.includes(mode)) {
    return { ok: false, failures: [`unknown gate mode ${JSON.stringify(mode)}`] }
  }
  if (results === null || typeof results !== "object" || Array.isArray(results)) {
    return { ok: false, failures: ["the job results payload is missing or not an object"] }
  }
  const observed = GATE_JOBS.map(({ job }) => {
    const entry = results[job]
    const result = typeof entry === "object" && entry !== null ? entry.result : undefined
    return `${job}=${result ?? "missing"}`
  })
  if (mode === "serial-baseline") {
    return {
      ok: false,
      observed,
      failures: [
        "serial-baseline is a manual benchmark mode: the isolated groups did not run, so the full-group required gate is not satisfied",
      ],
    }
  }

  const failures = []
  for (const { job, group, label } of GATE_JOBS) {
    const entry = results[job]
    const result = typeof entry === "object" && entry !== null ? entry.result : undefined
    if (result === undefined) {
      failures.push(`${label}: required job "${job}" is missing from this run`)
      continue
    }
    if (result !== "success") {
      failures.push(`${label}: required job "${job}" finished with result "${result}", expected "success"`)
    }
  }

  // An unexpected extra entry cannot turn a failure green, but it means the
  // aggregate `needs` list and this gate have drifted apart.
  const expected = new Set(GATE_JOBS.map(({ job }) => job))
  for (const job of Object.keys(results)) {
    if (!expected.has(job)) failures.push(`unexpected job "${job}" in the gate payload; fix the aggregate needs list`)
  }

  return { ok: failures.length === 0, failures, observed }
}

/** Render the human-readable verdict lines for the CI log. */
export function formatVerdict({ observed = [], failures = [] }) {
  return [`observed: ${observed.join(", ") || "(none)"}`, ...failures.map((failure) => `- ${failure}`)]
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith("--") || value === undefined) throw new Error(`invalid argument ${JSON.stringify(key)}`)
    options[key.slice(2)] = value
  }
  return options
}

function readPayload(options) {
  if (options.results) return JSON.parse(readFileSync(options.results, "utf8"))
  const raw = process.env.E2E_GROUP_RESULTS
  if (!raw) throw new Error("E2E_GROUP_RESULTS is empty; the aggregate job must pass toJSON(needs)")
  return JSON.parse(raw)
}

function main(argv) {
  const options = parseArgs(argv)
  const mode = options.mode ?? process.env.E2E_GATE_MODE ?? "groups"
  const results = readPayload(options)
  const verdict = evaluateGate({ results, mode })
  for (const line of formatVerdict(verdict)) console.log(line)
  if (!verdict.ok) {
    console.error("Real OpenCode latest E2E gate: NOT satisfied")
    process.exit(1)
  }
  console.log("Real OpenCode latest E2E gate: resolved host + groups A/B/C/D all succeeded")
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(`check-e2e-groups: ${error.message}`)
    process.exit(1)
  }
}
