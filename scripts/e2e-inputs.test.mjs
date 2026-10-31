import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import {
  checkFullBaseline,
  compareGitInputs,
  compareHostInputs,
  digestHostLock,
  OPENCODE_REQUIRED_GROUPS,
  PI_REQUIRED_GROUPS,
  releaseNotesPath,
} from "./e2e-inputs.mjs"

const BASE_VERSION = "1.0.0"
const NEXT_VERSION = "1.1.0"
const CORE_SHA = "c".repeat(40)
const ARTIFACT_DIGEST = `sha256:${"a".repeat(64)}`
const REPOSITORY = "rpchen/opencode-litellm-provider"

/**
 * Build the tracked file set of a fixture repository. Every variation below is
 * a real content change; nothing depends on a specific upstream SHA or release
 * label.
 */
function treeFiles(options = {}) {
  const version = options.version ?? BASE_VERSION
  const notesVersion = options.notesVersion ?? version
  const manifest = {
    name: "litellm-fixture",
    version: options.manifestVersion ?? version,
    type: "module",
    dependencies: options.dependencies ?? { "litellm-core": "1.0.0" },
    scripts: options.scripts ?? { test: "node --test" },
  }
  const lock = {
    name: "litellm-fixture",
    version: options.lockVersion ?? version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: "litellm-fixture",
        version: options.lockRootVersion ?? options.lockVersion ?? version,
        dependencies: { "litellm-core": "1.0.0" },
      },
      "node_modules/litellm-core": { version: "1.0.0" },
      ...(options.lockPackages ?? {}),
    },
  }
  const identity = {
    pluginVersion: options.pluginVersion ?? version,
    artifactDigest: ARTIFACT_DIGEST,
    coreCommit: CORE_SHA,
    ...(options.identityExtra ?? {}),
  }
  return {
    "README.md": [
      "# fixture provider",
      "",
      `锁定当前发行版：v${options.readmeVersion ?? version}`,
      "",
      `[v${notesVersion} release notes](${releaseNotesPath(notesVersion)})`,
      "",
    ].join("\n"),
    "package.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "package-lock.json": `${JSON.stringify(lock, null, 2)}\n`,
    "dist/runtime-identity.json": `${JSON.stringify(identity, null, 2)}\n`,
    "dist/index.js": options.distIndex ?? "export const ok = true\n",
    [`docs/releases/v${notesVersion}.md`]: `# v${notesVersion}\n\n- notes\n`,
    "docs/e2e-ci.md": "<!-- harness documentation -->\n",
    "scripts/e2e-opencode-v2.mjs": options.harness ?? "// harness v1\n",
    ".github/workflows/ci.yml": "name: CI\non: push\n",
    "test/fixture.json": `${JSON.stringify({ models: ["a", "b"] })}\n`,
  }
}

function runGit(dir, args) {
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`)
  }
  return result.stdout.trim()
}

/** A throw-away repository in the system temp directory. */
function createRepo(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "e2e-inputs-fixture-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  runGit(dir, ["init", "-q", "-b", "main"])
  runGit(dir, ["config", "user.email", "e2e-inputs@example.com"])
  runGit(dir, ["config", "user.name", "E2E Inputs Fixture"])
  runGit(dir, ["config", "commit.gpgsign", "false"])
  runGit(dir, ["config", "core.autocrlf", "false"])

  function write(files) {
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(dir, file)
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, content)
    }
  }

  /** Commit a complete tracked file set and return the new commit SHA. */
  function commit(files, message, { exec = [], remove = [], allowEmpty = false } = {}) {
    write(files)
    for (const file of remove) rmSync(path.join(dir, file), { force: true })
    runGit(dir, ["add", "-A"])
    for (const file of exec) runGit(dir, ["update-index", "--chmod=+x", file])
    runGit(dir, ["commit", "-q", ...(allowEmpty ? ["--allow-empty"] : []), "-m", message])
    return runGit(dir, ["rev-parse", "HEAD"])
  }

  return { dir, write, commit, git: (args) => runGit(dir, args) }
}

function compareBoth(repo, { baselineCandidate, candidate, baselineHarness, harness }) {
  return compareGitInputs({ root: repo.dir, baselineCandidate, candidate, baselineHarness, harness })
}

function changedPathList(result) {
  return result.candidate.changedPaths.map((change) => `${change.status}:${change.path}`).sort()
}

test("two SHAs with the same tree are a delivery-only input change", (t) => {
  const repo = createRepo(t)
  const base = repo.commit(treeFiles(), "baseline", { allowEmpty: true })
  const sameTree = repo.commit(treeFiles(), "keep the same tree", { allowEmpty: true })

  const result = compareBoth(repo, {
    baselineCandidate: base,
    candidate: sameTree,
    baselineHarness: base,
    harness: sameTree,
  })

  assert.equal(result.ok, true, result.reason)
  assert.equal(result.verdict, "delivery")
  assert.equal(result.version, BASE_VERSION)
  assert.deepEqual(result.candidate.changedPaths, [])
  assert.deepEqual(result.harness.changedPaths, [])
  assert.deepEqual(result.candidate.current.tree, result.candidate.baseline.tree)
})

test("a version-only change touching README and the new release notes is delivery", (t) => {
  const repo = createRepo(t)
  const base = repo.commit(treeFiles(), "baseline")
  const next = repo.commit(treeFiles({ version: NEXT_VERSION }), "release version bump")

  const result = compareBoth(repo, {
    baselineCandidate: base,
    candidate: next,
    baselineHarness: base,
    harness: next,
  })

  assert.equal(result.ok, true, result.reason)
  assert.equal(result.verdict, "delivery")
  assert.equal(result.version, NEXT_VERSION)
  assert.deepEqual(changedPathList(result), [
    `added:${releaseNotesPath(NEXT_VERSION)}`,
    "modified:README.md",
    "modified:dist/runtime-identity.json",
    "modified:package-lock.json",
    "modified:package.json",
  ])
})

test("the comparison reads Git objects, never the working tree", (t) => {
  const repo = createRepo(t)
  const base = repo.commit(treeFiles(), "baseline")
  const next = repo.commit(treeFiles({ version: NEXT_VERSION }), "release version bump")
  // Dirty the checkout: an uncommitted README edit and an untracked file.
  repo.write({ "README.md": "# unrelated local edit\n", "notes.txt": "scratch\n" })

  const result = compareBoth(repo, {
    baselineCandidate: base,
    candidate: next,
    baselineHarness: base,
    harness: next,
  })

  assert.equal(result.ok, true, result.reason)
  assert.deepEqual(changedPathList(result), [
    `added:${releaseNotesPath(NEXT_VERSION)}`,
    "modified:README.md",
    "modified:dist/runtime-identity.json",
    "modified:package-lock.json",
    "modified:package.json",
  ])
})

test("an extra dependency on the package.json path is full", (t) => {
  const repo = createRepo(t)
  const base = repo.commit(treeFiles(), "baseline")
  const candidate = repo.commit(
    treeFiles({ version: NEXT_VERSION, dependencies: { "litellm-core": "1.0.0", "left-pad": "1.3.0" } }),
    "add a dependency while bumping",
  )

  const result = compareBoth(repo, {
    baselineCandidate: base,
    candidate,
    baselineHarness: base,
    harness: base,
  })

  assert.equal(result.ok, false)
  assert.equal(result.verdict, "full")
  assert.ok(
    result.failures.some((failure) => failure.includes("package.json") && failure.includes("beyond the root version field")),
    result.reason,
  )
})

test("an extra script on the package.json path is full", (t) => {
  const repo = createRepo(t)
  const base = repo.commit(treeFiles(), "baseline")
  const candidate = repo.commit(
    treeFiles({ version: NEXT_VERSION, scripts: { test: "node --test", e2e: "node scripts/e2e-opencode-v2.mjs" } }),
    "add a script while bumping",
  )

  const result = compareBoth(repo, { baselineCandidate: base, candidate, baselineHarness: base, harness: base })

  assert.equal(result.ok, false)
  assert.ok(result.failures.some((failure) => failure.includes("package.json")))
})

test("an extra lock entry is full even with the version-only fields allowed", (t) => {
  const repo = createRepo(t)
  const base = repo.commit(treeFiles(), "baseline")
  const candidate = repo.commit(
    treeFiles({ version: NEXT_VERSION, lockPackages: { "node_modules/left-pad": { version: "1.3.0" } } }),
    "lock another package",
  )

  const result = compareBoth(repo, { baselineCandidate: base, candidate, baselineHarness: base, harness: base })

  assert.equal(result.ok, false)
  assert.ok(
    result.failures.some((failure) => failure.includes("package-lock.json") && failure.includes("beyond the root version fields")),
    result.reason,
  )
})

test("an extra runtime-identity field is full", (t) => {
  const repo = createRepo(t)
  const base = repo.commit(treeFiles(), "baseline")
  const candidate = repo.commit(
    treeFiles({ version: NEXT_VERSION, identityExtra: { buildFlavor: "local" } }),
    "extend the identity record",
  )

  const result = compareBoth(repo, { baselineCandidate: base, candidate, baselineHarness: base, harness: base })

  assert.equal(result.ok, false)
  assert.ok(
    result.failures.some((failure) => failure.includes("dist/runtime-identity.json") && failure.includes("pluginVersion")),
    result.reason,
  )
})

test("a changed delivery blob is full even though the artifact digest is unchanged", (t) => {
  const repo = createRepo(t)
  const base = repo.commit(treeFiles(), "baseline")
  const files = treeFiles()
  files["dist/index.js"] = "export const ok = false\n"
  const candidate = repo.commit(files, "change a dist file the identity digest does not cover")

  const result = compareBoth(repo, { baselineCandidate: base, candidate, baselineHarness: base, harness: base })

  assert.equal(result.ok, false)
  assert.ok(result.failures.some((failure) => failure.includes("dist/index.js")), result.reason)
  // The identity record itself is byte-identical here: only the other dist blob moved.
  assert.ok(!changedPathList(result).includes("modified:dist/runtime-identity.json"))
})

test("a mode change with an identical blob is full", (t) => {
  const repo = createRepo(t)
  const base = repo.commit(treeFiles(), "baseline")
  const candidate = repo.commit(treeFiles(), "make the harness executable", {
    exec: ["scripts/e2e-opencode-v2.mjs"],
  })

  const result = compareBoth(repo, { baselineCandidate: base, candidate, baselineHarness: base, harness: base })

  assert.equal(result.ok, false)
  const change = result.candidate.changedPaths.find((entry) => entry.path === "scripts/e2e-opencode-v2.mjs")
  assert.ok(change, "the mode change must be listed")
  assert.notEqual(change.before.mode, change.after.mode)
  assert.equal(change.before.object, change.after.object)
  assert.ok(result.failures.some((failure) => failure.includes("mode or type changed")), result.reason)
})

test("deleting old release notes is full", (t) => {
  const repo = createRepo(t)
  const base = repo.commit(treeFiles(), "baseline")
  const candidate = repo.commit(treeFiles({ version: NEXT_VERSION }), "bump and drop the old notes", {
    remove: [releaseNotesPath(BASE_VERSION)],
  })

  const result = compareBoth(repo, { baselineCandidate: base, candidate, baselineHarness: base, harness: base })

  assert.equal(result.ok, false)
  assert.ok(
    result.failures.some(
      (failure) => failure.includes(releaseNotesPath(BASE_VERSION)) && failure.includes("release notes may not be deleted"),
    ),
    result.reason,
  )
})

test("changing other documentation is full", (t) => {
  const repo = createRepo(t)
  const base = repo.commit(treeFiles(), "baseline")
  const files = treeFiles({ version: NEXT_VERSION })
  files["docs/e2e-ci.md"] = "<!-- changed harness documentation -->\n"
  const candidate = repo.commit(files, "change another doc")

  const result = compareBoth(repo, { baselineCandidate: base, candidate, baselineHarness: base, harness: base })

  assert.equal(result.ok, false)
  assert.ok(result.failures.some((failure) => failure.includes("docs/e2e-ci.md")), result.reason)
})

test("adding a new tracked file is full and deleting README is full", (t) => {
  const repo = createRepo(t)
  const base = repo.commit(treeFiles(), "baseline")
  const added = { ...treeFiles(), "docs/new-notes.md": "# new\n" }
  const withAdded = repo.commit(added, "add a doc")
  const addedResult = compareBoth(repo, {
    baselineCandidate: base,
    candidate: withAdded,
    baselineHarness: base,
    harness: base,
  })
  assert.equal(addedResult.ok, false)
  assert.ok(addedResult.failures.some((failure) => failure.includes("docs/new-notes.md") && failure.includes("added")))

  const withoutReadme = repo.commit(treeFiles(), "drop the readme", { remove: ["README.md"] })
  const removedResult = compareBoth(repo, {
    baselineCandidate: base,
    candidate: withoutReadme,
    baselineHarness: base,
    harness: base,
  })
  assert.equal(removedResult.ok, false)
  assert.ok(removedResult.failures.some((failure) => failure.includes("README.md") && failure.includes("removed files")))
})

test("the same candidate with a changed harness is full, and the pairs never mix", (t) => {
  const repo = createRepo(t)
  const base = repo.commit(treeFiles(), "baseline")
  const versioned = repo.commit(treeFiles({ version: NEXT_VERSION }), "release version bump")
  const harnessChanged = repo.commit(treeFiles({ version: NEXT_VERSION, harness: "// harness v2\n" }), "change the harness")

  const result = compareBoth(repo, {
    baselineCandidate: versioned,
    candidate: versioned,
    baselineHarness: versioned,
    harness: harnessChanged,
  })

  assert.equal(result.ok, false)
  assert.deepEqual(result.candidate.changedPaths, [], "the candidate pair is unchanged")
  assert.deepEqual(
    result.harness.changedPaths.map((change) => change.path),
    ["scripts/e2e-opencode-v2.mjs"],
  )
  assert.ok(result.failures.every((failure) => failure.startsWith("harness")), result.reason)
  assert.equal(result.version, NEXT_VERSION)
})

test("a missing Git object returns full with a public reason instead of throwing", (t) => {
  const repo = createRepo(t)
  const base = repo.commit(treeFiles(), "baseline")
  const missing = "0".repeat(40)

  const result = compareBoth(repo, {
    baselineCandidate: base,
    candidate: missing,
    baselineHarness: base,
    harness: base,
  })

  assert.equal(result.ok, false)
  assert.equal(result.verdict, "full")
  assert.ok(
    result.failures.some((failure) => failure.includes("current candidate") && failure.includes(missing)),
    result.reason,
  )
  assert.equal(result.candidate.current, null)
})

test("mutable revisions and an empty input are rejected without throwing", (t) => {
  const repo = createRepo(t)
  const base = repo.commit(treeFiles(), "baseline")

  const branch = compareBoth(repo, { baselineCandidate: base, candidate: "main", baselineHarness: base, harness: base })
  assert.equal(branch.ok, false)
  assert.ok(branch.failures.some((failure) => failure.includes("40-character lowercase commit SHA")))

  const empty = compareBoth(repo, { baselineCandidate: base, candidate: "", baselineHarness: base, harness: base })
  assert.equal(empty.ok, false)
  assert.ok(empty.failures.some((failure) => failure.includes("current candidate is missing")))

  const noRoot = compareGitInputs({ baselineCandidate: base, candidate: base, baselineHarness: base, harness: base })
  assert.equal(noRoot.ok, false)
  assert.ok(noRoot.failures.some((failure) => failure.includes("root")))
})

test("an internally inconsistent candidate version is full", (t) => {
  const repo = createRepo(t)
  const base = repo.commit(treeFiles(), "baseline")
  const candidate = repo.commit(
    treeFiles({ version: NEXT_VERSION, lockVersion: BASE_VERSION, lockRootVersion: BASE_VERSION }),
    "bump only the manifest",
  )

  const result = compareBoth(repo, { baselineCandidate: base, candidate, baselineHarness: base, harness: base })

  assert.equal(result.ok, false)
  assert.ok(
    result.failures.some((failure) => failure.includes("package-lock.json") && failure.includes("version")),
    result.reason,
  )
})

test("an internally inconsistent baseline version is full", (t) => {
  const repo = createRepo(t)
  const base = repo.commit(treeFiles(), "baseline")
  const candidate = repo.commit(treeFiles(), "unchanged content", { allowEmpty: true })
  const badBaseline = repo.commit(treeFiles({ pluginVersion: "9.9.9" }), "baseline with a lying identity")

  const result = compareGitInputs({
    root: repo.dir,
    baselineCandidate: badBaseline,
    candidate,
    baselineHarness: base,
    harness: candidate,
  })

  assert.equal(result.ok, false)
  assert.ok(
    result.failures.some(
      (failure) => failure.includes("baseline candidate") && failure.includes("pluginVersion"),
    ),
    result.reason,
  )
})

function hostInput(overrides = {}) {
  return {
    hostPackage: "@opencode/cli",
    hostVersion: "2.0.16",
    candidateSha: "1".repeat(40),
    node: "v22.11.0",
    npm: "10.9.4",
    os: { platform: "linux", arch: "x64", release: "6.8.0-1019-azure" },
    runner: { ImageOS: "ubuntu24", ImageVersion: "20250101.1.0" },
    resolvedAt: "2026-01-01T00:00:00.000Z",
    packageSpec: `github:${REPOSITORY}#${"1".repeat(40)}`,
    hostBin: "/home/runner/work/_temp/host/node_modules/.bin/opencode",
    hostLock: ["package.json", "package-lock.json"],
    ...overrides,
  }
}

const HOST_CONFIG = {
  installMode: "prefix-lock",
  npmFlags: ["--no-audit", "--no-fund"],
  pluginInstall: "opencode plugin add",
}

const HOST_LOCK = digestHostLock({
  packageJson: '{"name":"opencode-e2e-host","private":true,"version":"0.0.0"}\n',
  packageLock: '{"lockfileVersion":3,"packages":{"node_modules/@opencode/cli":{"version":"2.0.16"}}}\n',
})

function hostSide(overrides = {}) {
  return {
    hostInput: hostInput(),
    lockDigest: HOST_LOCK,
    config: { ...HOST_CONFIG, npmFlags: [...HOST_CONFIG.npmFlags] },
    ...overrides,
  }
}

test("a matching host input is delivery even though per-run locators differ", () => {
  const baseline = hostSide({
    hostInput: hostInput({
      resolvedAt: "2025-12-31T00:00:00.000Z",
      hostBin: "/home/runner/work/_temp/other-prefix/node_modules/.bin/opencode",
      candidateSha: "2".repeat(40),
      packageSpec: `github:${REPOSITORY}#${"2".repeat(40)}`,
      os: { platform: "linux", arch: "x64", release: "6.5.0-1025-azure" },
    }),
  })

  const result = compareHostInputs({ baseline, current: hostSide() })

  assert.equal(result.ok, true, result.reason)
  assert.equal(result.verdict, "delivery")
})

for (const [label, override, expected] of [
  ["hostVersion", { hostVersion: "2.0.17" }, "hostVersion"],
  ["node", { node: "v22.12.0" }, "node"],
  ["npm", { npm: "10.9.3" }, "npm"],
  ["platform", { os: { platform: "darwin", arch: "x64", release: "23.0.0" } }, "os.platform"],
  ["arch", { os: { platform: "linux", arch: "arm64", release: "6.8.0-1019-azure" } }, "os.arch"],
  ["runner image OS", { runner: { ImageOS: "ubuntu22", ImageVersion: "20250101.1.0" } }, "runner.ImageOS"],
  ["runner image version", { runner: { ImageOS: "ubuntu24", ImageVersion: "20250201.1.0" } }, "runner.ImageVersion"],
  ["host package", { hostPackage: "@opencode/cli-next" }, "hostPackage"],
]) {
  test(`a ${label} change between baseline and current is full`, () => {
    const result = compareHostInputs({
      baseline: hostSide(),
      current: hostSide({ hostInput: hostInput(override) }),
    })
    assert.equal(result.ok, false)
    assert.equal(result.verdict, "full")
    assert.ok(result.failures.some((failure) => failure.includes(expected)), result.reason)
  })
}

test("a different host lock digest is full", () => {
  const otherLock = digestHostLock({
    packageJson: '{"name":"opencode-e2e-host","private":true,"version":"0.0.0"}\n',
    packageLock: '{"lockfileVersion":3,"packages":{"node_modules/@opencode/cli":{"version":"2.0.17"}}}\n',
  })
  assert.notEqual(otherLock, HOST_LOCK)

  const result = compareHostInputs({ baseline: hostSide(), current: hostSide({ lockDigest: otherLock }) })
  assert.equal(result.ok, false)
  assert.ok(result.failures.some((failure) => failure.includes("host lock digest")))
})

test("a different fixed configuration is full", () => {
  const result = compareHostInputs({
    baseline: hostSide(),
    current: hostSide({ config: { ...HOST_CONFIG, npmFlags: ["--no-audit", "--no-fund", "--ignore-scripts"] } }),
  })
  assert.equal(result.ok, false)
  assert.ok(result.failures.some((failure) => failure.includes("fixed configuration") && failure.includes("npmFlags")))
})

test("null or missing required host metadata is full", () => {
  const nullNpm = compareHostInputs({ baseline: hostSide(), current: hostSide({ hostInput: hostInput({ npm: null }) }) })
  assert.equal(nullNpm.ok, false)
  assert.ok(nullNpm.failures.some((failure) => failure.includes("npm") && failure.includes("null")))

  const noRunner = compareHostInputs({
    baseline: hostSide(),
    current: hostSide({ hostInput: hostInput({ runner: { ImageOS: "ubuntu24", ImageVersion: null } }) }),
  })
  assert.equal(noRunner.ok, false)
  assert.ok(noRunner.failures.some((failure) => failure.includes("runner.ImageVersion") && failure.includes("null")))

  const missingSide = compareHostInputs({ baseline: hostSide(), current: undefined })
  assert.equal(missingSide.ok, false)
  assert.ok(missingSide.failures.some((failure) => failure.includes("current")))

  const emptyConfig = compareHostInputs({ baseline: hostSide(), current: hostSide({ config: {} }) })
  assert.equal(emptyConfig.ok, false)
  assert.ok(emptyConfig.failures.some((failure) => failure.includes("configuration")))
})

test("an unexpected host input field fails closed", () => {
  const result = compareHostInputs({
    baseline: hostSide(),
    current: hostSide({ hostInput: hostInput({ runner: { ImageOS: "ubuntu24", ImageVersion: "20250101.1.0", extra: "x" } }) }),
  })
  assert.equal(result.ok, false)
  assert.ok(result.failures.some((failure) => failure.includes("runner.extra")))
})

test("digestHostLock is stable per byte content and covers both files", () => {
  const base = digestHostLock({ packageJson: "m1", packageLock: "l1" })
  assert.match(base, /^sha256:[0-9a-f]{64}$/u)
  assert.equal(digestHostLock({ packageJson: "m1", packageLock: "l1" }), base)
  assert.notEqual(digestHostLock({ packageJson: "m1", packageLock: "l2" }), base)
  assert.notEqual(digestHostLock({ packageJson: "m2", packageLock: "l1" }), base)
  assert.notEqual(digestHostLock({ packageJson: "m1l1", packageLock: "" }), base)
  assert.throws(() => digestHostLock({ packageJson: "m1" }), /packageLock/u)
})

function baselineRecord(overrides = {}) {
  return {
    kind: "full",
    repository: REPOSITORY,
    runId: 4123456789,
    runAttempt: 1,
    candidateSha: "1".repeat(40),
    harnessSha: "1".repeat(40),
    groups: { A: "success", B: "success", C: "success", D: "success" },
    ...overrides,
  }
}

test("a complete matrix success of this repository is a valid baseline", () => {
  const verdict = checkFullBaseline({ baseline: baselineRecord(), repository: REPOSITORY })
  assert.equal(verdict.ok, true, verdict.failures.join("; "))
  assert.deepEqual(verdict.observed.groups, ["A", "B", "C", "D"])
  assert.deepEqual(OPENCODE_REQUIRED_GROUPS, ["A", "B", "C", "D"])
})

test("object-shaped group results are accepted too", () => {
  const verdict = checkFullBaseline({
    baseline: baselineRecord({
      groups: Object.fromEntries(OPENCODE_REQUIRED_GROUPS.map((group) => [group, { result: "success" }])),
    }),
    repository: REPOSITORY,
  })
  assert.equal(verdict.ok, true, verdict.failures.join("; "))
})

test("the group set must match the adapter exactly", () => {
  const pi = baselineRecord({ groups: { pi: "success" } })
  assert.equal(checkFullBaseline({ baseline: pi, repository: REPOSITORY, requiredGroups: PI_REQUIRED_GROUPS }).ok, true)
  const wrongAdapter = checkFullBaseline({ baseline: pi, repository: REPOSITORY })
  assert.equal(wrongAdapter.ok, false)
  assert.ok(wrongAdapter.failures.some((failure) => failure.includes("unexpected group \"pi\"")))
  assert.ok(wrongAdapter.failures.some((failure) => failure.includes("required group \"A\"")))

  const extra = checkFullBaseline({
    baseline: baselineRecord({ groups: { A: "success", B: "success", C: "success", D: "success", E: "success" } }),
    repository: REPOSITORY,
  })
  assert.equal(extra.ok, false)
  assert.ok(extra.failures.some((failure) => failure.includes("unexpected group \"E\"")))

  const missing = checkFullBaseline({
    baseline: baselineRecord({ groups: { A: "success", B: "success", C: "success" } }),
    repository: REPOSITORY,
  })
  assert.equal(missing.ok, false)
  assert.ok(missing.failures.some((failure) => failure.includes("required group \"D\" is missing")))
})

test("a non-full or failed baseline cannot be reused", () => {
  const smoke = checkFullBaseline({ baseline: baselineRecord({ kind: "smoke" }), repository: REPOSITORY })
  assert.equal(smoke.ok, false)
  assert.ok(smoke.failures.some((failure) => failure.includes("\"smoke\"") && failure.includes("not \"full\"")))

  for (const result of ["failure", "cancelled", "skipped", "neutral"]) {
    const failed = checkFullBaseline({
      baseline: baselineRecord({ groups: { A: "success", B: result, C: "success", D: "success" } }),
      repository: REPOSITORY,
    })
    assert.equal(failed.ok, false, `${result} must not be reusable`)
    assert.ok(failed.failures.some((failure) => failure.includes("\"B\"") && failure.includes(result)))
  }
})

test("run id, attempt and repository must be real and this repository's", () => {
  for (const overrides of [{ runId: 0 }, { runId: "4123456789" }, { runId: undefined }]) {
    const verdict = checkFullBaseline({ baseline: baselineRecord(overrides), repository: REPOSITORY })
    assert.equal(verdict.ok, false, JSON.stringify(overrides))
    assert.ok(verdict.failures.some((failure) => failure.includes("runId")))
  }
  const attempt = checkFullBaseline({ baseline: baselineRecord({ runAttempt: undefined }), repository: REPOSITORY })
  assert.equal(attempt.ok, false)
  assert.ok(attempt.failures.some((failure) => failure.includes("runAttempt")))

  const otherRepo = checkFullBaseline({ baseline: baselineRecord({ repository: "rpchen/pi-litellm-provider" }), repository: REPOSITORY })
  assert.equal(otherRepo.ok, false)
  assert.ok(otherRepo.failures.some((failure) => failure.includes("repository")))

  const noRepo = checkFullBaseline({ baseline: baselineRecord() })
  assert.equal(noRepo.ok, false)
  assert.ok(noRepo.failures.some((failure) => failure.includes("repository (owner/name) is required")))
})

test("a missing baseline record fails closed", () => {
  for (const baseline of [undefined, null, [], "full", 42]) {
    const verdict = checkFullBaseline({ baseline, repository: REPOSITORY })
    assert.equal(verdict.ok, false)
    assert.deepEqual(verdict.observed, {})
  }
})
