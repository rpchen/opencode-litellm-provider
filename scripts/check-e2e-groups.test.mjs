import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { E2E_GROUPS, GATE_JOBS, evaluateGate, formatVerdict } from "./check-e2e-groups.mjs"

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(SCRIPT_DIR, "check-e2e-groups.mjs")
const WORKFLOW = path.join(SCRIPT_DIR, "..", ".github", "workflows", "ci.yml")

/** A realistic `toJSON(needs)` payload where every required job succeeded. */
function successPayload() {
  return Object.fromEntries(
    GATE_JOBS.map(({ job }) => [job, { result: "success", outputs: {} }]),
  )
}

function withResult(job, result) {
  const payload = successPayload()
  if (result === undefined) delete payload[job]
  else payload[job].result = result
  return payload
}

test("the gate requires the resolve job plus the four fixed groups", () => {
  assert.deepEqual(E2E_GROUPS, ["A", "B", "C", "D"])
  assert.deepEqual(
    GATE_JOBS.map(({ job }) => job),
    ["resolve-host", "e2e-group-a", "e2e-group-b", "e2e-group-c", "e2e-group-d"],
  )
})

test("all required jobs succeeding satisfies the gate", () => {
  const verdict = evaluateGate({ results: successPayload(), mode: "groups" })
  assert.equal(verdict.ok, true, formatVerdict(verdict).join("\n"))
  assert.deepEqual(verdict.failures, [])
})

for (const result of ["failure", "cancelled", "skipped", "neutral", "timed_out", "action_required"]) {
  test(`a "${result}" required job does not satisfy the gate`, () => {
    for (const { job } of GATE_JOBS) {
      const verdict = evaluateGate({ results: withResult(job, result), mode: "groups" })
      assert.equal(verdict.ok, false, `${job}=${result} must not be green`)
      assert.ok(
        verdict.failures.some((failure) => failure.includes(`"${job}"`) && failure.includes(result)),
        `failure must name ${job} and ${result}: ${JSON.stringify(verdict.failures)}`,
      )
    }
  })
}

test("a missing required job does not satisfy the gate", () => {
  for (const { job } of GATE_JOBS) {
    const verdict = evaluateGate({ results: withResult(job, undefined), mode: "groups" })
    assert.equal(verdict.ok, false, `${job} missing must not be green`)
    assert.ok(verdict.failures.some((failure) => failure.includes(job) && failure.includes("missing")))
  }
})

test("a resolve failure alone fails the gate", () => {
  const verdict = evaluateGate({ results: withResult("resolve-host", "failure"), mode: "groups" })
  assert.equal(verdict.ok, false)
})

test("delivery mode accepts only successful current verification and explicitly skipped groups with a full baseline", () => {
  const delivery = () => Object.fromEntries(GATE_JOBS.map(({ job }) => [job,
    job === "resolve-host" ? { result: "success", outputs: { "verification-mode": "delivery", "verification-baseline": "123/1" } } : { result: "skipped" },
  ]))
  assert.equal(evaluateGate({ results: delivery() }).ok, true)
  for (const { job } of GATE_JOBS) {
    for (const result of ["failure", "cancelled", undefined]) {
      const payload = delivery()
      if (result) payload[job].result = result
      else delete payload[job]
      assert.equal(evaluateGate({ results: payload }).ok, false, `${job}=${result}`)
    }
  }
  const missingBaseline = delivery()
  delete missingBaseline["resolve-host"].outputs["verification-baseline"]
  assert.equal(evaluateGate({ results: missingBaseline }).ok, false)
  const unknown = delivery()
  unknown["resolve-host"].outputs["verification-mode"] = "unknown"
  assert.equal(evaluateGate({ results: unknown }).ok, false)
  const mixed = delivery()
  mixed["e2e-group-a"].result = "success"
  assert.equal(evaluateGate({ results: mixed }).ok, false)
})

test("an empty, malformed or non-object payload fails closed", () => {
  assert.equal(evaluateGate({ results: {}, mode: "groups" }).ok, false)
  assert.equal(evaluateGate({ results: undefined, mode: "groups" }).ok, false)
  assert.equal(evaluateGate({ results: [], mode: "groups" }).ok, false)
  assert.equal(evaluateGate({ results: successPayload(), mode: "unknown-mode" }).ok, false)
})

test("an unexpected extra job in the payload is reported as drift", () => {
  const payload = successPayload()
  payload["e2e-group-e"] = { result: "success" }
  const verdict = evaluateGate({ results: payload, mode: "groups" })
  assert.equal(verdict.ok, false)
  assert.ok(verdict.failures.some((failure) => failure.includes("e2e-group-e")))
})

test("serial-baseline mode never reports the full-group gate as satisfied", () => {
  // The group jobs are skipped in benchmark mode; the gate must stay red and
  // must not silently accept a benchmark run as a complete matrix.
  const payload = Object.fromEntries(
    GATE_JOBS.map(({ job }) => [job, { result: job === "resolve-host" ? "success" : "skipped" }]),
  )
  const verdict = evaluateGate({ results: payload, mode: "serial-baseline" })
  assert.equal(verdict.ok, false)
  assert.ok(verdict.failures.some((failure) => /benchmark mode/u.test(failure)))

  // Even a payload in which all groups report success is not a benchmark
  // result, so it cannot be accepted as one.
  assert.equal(evaluateGate({ results: successPayload(), mode: "serial-baseline" }).ok, false)
})

test("the CLI exits non-zero on a skipped group and zero on full success", async () => {
  const { spawnSync } = await import("node:child_process")
  const script = SCRIPT
  const runCli = (results, mode = "groups") =>
    spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, E2E_GROUP_RESULTS: JSON.stringify(results), E2E_GATE_MODE: mode },
    })

  const green = runCli(successPayload())
  assert.equal(green.status, 0, green.stderr)
  assert.match(green.stdout, /resolved host \+ groups A\/B\/C\/D all succeeded/u)

  const red = runCli(withResult("e2e-group-c", "cancelled"))
  assert.notEqual(red.status, 0)
  assert.match(red.stderr, /NOT satisfied/u)

  const missing = runCli(withResult("e2e-group-d", undefined))
  assert.notEqual(missing.status, 0)

  const benchmark = runCli(withResult("e2e-group-a", "skipped"), "serial-baseline")
  assert.notEqual(benchmark.status, 0)
  assert.match(benchmark.stdout, /benchmark mode/u)

  const noPayload = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, E2E_GROUP_RESULTS: "" },
  })
  assert.notEqual(noPayload.status, 0)
})

test("--results reads the payload from a file", async () => {
  const { spawnSync } = await import("node:child_process")
  const script = SCRIPT
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "gate-")), "needs.json")
  writeFileSync(file, JSON.stringify(successPayload()))
  const result = spawnSync(process.execPath, [script, "--results", file], {
    encoding: "utf8",
    env: { ...process.env, E2E_GROUP_RESULTS: "" },
  })
  assert.equal(result.status, 0, result.stderr)
})

/**
 * Drift guard for the one thing the helpers cannot prove by themselves: the
 * workflow must publish exactly one check named `Real OpenCode latest E2E`, keep
 * the four fixed group job ids wired to distinct `E2E_GROUP` values, and make
 * that aggregate depend on the resolve job and all four groups with
 * `if: always()`. Without this, a rename would silently turn the required check
 * into a permanently skipped job.
 */
test("ci.yml keeps the required aggregate check and four fixed group jobs", () => {
  const workflow = readFileSync(WORKFLOW, "utf8").replace(/\r\n?/gu, "\n")
  const lines = workflow.split(/\r?\n/u)

  const jobBlocks = new Map()
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^ {2}([A-Za-z0-9_-]+):$/u)
    if (!match) continue
    let end = index + 1
    while (end < lines.length && !/^ {2}[A-Za-z0-9_-]+:$/u.test(lines[end])) end += 1
    jobBlocks.set(match[1], lines.slice(index, end).join("\n"))
  }

  assert.ok(jobBlocks.has("verify"), "the regular CI job must stay")
  assert.match(jobBlocks.get("verify"), /^ {4}name: CI$/mu, "the CI check name must stay")

  const aggregates = [...jobBlocks.entries()].filter(([, block]) =>
    /^ {4}name: Real OpenCode latest E2E$/mu.test(block),
  )
  assert.equal(aggregates.length, 1, "exactly one job may publish the required check name")
  const [aggregateId, aggregate] = aggregates[0]
  assert.match(aggregate, /^ {4}if: always\(\)$/mu, "the aggregate must run even when a group fails")
  assert.ok(!/continue-on-error/u.test(aggregate), "the aggregate must not swallow failures")
  for (const { job } of GATE_JOBS) {
    assert.ok(
      new RegExp(`needs: \\[[^\\]]*\\b${job}\\b`, "u").test(aggregate),
      `the aggregate needs list must include ${job}`,
    )
  }
  assert.match(aggregate, /E2E_GROUP_RESULTS: \$\{\{ toJSON\(needs\) \}\}/u, "the aggregate must pass the real needs payload")
  assert.match(aggregate, /check-e2e-groups\.mjs/u)
  // The benchmark job is skipped outside its manual mode; putting it in the
  // aggregate needs list would feed a "skipped" entry into the gate payload.
  assert.ok(!/needs: \[[^\]]*e2e-serial-baseline/u.test(aggregate), "the benchmark job must stay out of the gate needs list")

  for (const group of E2E_GROUPS) {
    const id = `e2e-group-${group.toLowerCase()}`
    assert.ok(jobBlocks.has(id), `group job ${id} must keep its fixed id`)
    const block = jobBlocks.get(id)
    assert.match(block, new RegExp(`E2E_GROUP: ${group}$`, "mu"), `${id} must set E2E_GROUP=${group}`)
    assert.match(block, /E2E_TIMING_FILE: /u, `${id} must write a timing file`)
    assert.match(block, /needs: \[resolve-host\]/u, `${id} must wait for the resolved host`)
    assert.match(block, /upload-artifact@[0-9a-f]{40}/u, `${id} must upload timing with a pinned action SHA`)
  }

  assert.ok(jobBlocks.has("resolve-host"), "the resolve job must keep its fixed id")
  assert.match(jobBlocks.get("resolve-host"), /e2e-host\.mjs resolve/u)
  assert.match(jobBlocks.get("resolve-host"), /upload-artifact@[0-9a-f]{40}/u)
  assert.match(jobBlocks.get("resolve-host"), /CANDIDATE_SHA/u)

  // Groups skip only in the explicit benchmark mode; the default path runs them.
  for (const group of E2E_GROUPS) {
    const block = jobBlocks.get(`e2e-group-${group.toLowerCase()}`)
    assert.match(block, /serial-baseline/u, `${group} must be skipped only for the benchmark mode`)
  }

  assert.match(
    workflow,
    /workflow_dispatch:\n {4}inputs:\n {6}e2e_mode:/u,
    "manual dispatch must offer the benchmark mode selector",
  )
})
