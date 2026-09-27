import assert from "node:assert/strict"
import { test } from "node:test"
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  renameSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  CORE_REPOSITORY, GENERATED_PATH, assertCleanCheckout, exportCore, git,
  parseSelectionArgs, prepareCore, provenanceFor, readProvenance, selectCore, validateSHA,
} from "./prepare-core.mjs"
import { compareDistributions, verifyDistribution } from "./distribution.mjs"

const SHA = "a".repeat(40)
const NEXT_SHA = "b".repeat(40)

function temporary(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "opencode-core-test-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function write(root, name, value) {
  const filename = path.join(root, name)
  mkdirSync(path.dirname(filename), { recursive: true })
  writeFileSync(filename, value)
}

function checkout(t) {
  const temp = temporary(t)
  const cacheRoot = path.join(temp, "cache")
  const seed = path.join(temp, "seed")
  mkdirSync(seed)
  git(["init", "--quiet"], seed)
  git(["config", "user.name", "Core delivery fixture"], seed)
  git(["config", "user.email", "core-fixture@example.invalid"], seed)
  write(seed, "src/index.ts", 'export { value } from "./core/value.js"\n')
  write(seed, "src/core/value.ts", "export const value = 1\n")
  write(seed, "LICENSE", "MIT fixture license\n")
  write(seed, ".gitignore", "src/ignored.ts\n")
  git(["add", "."], seed)
  git(["commit", "--quiet", "-m", "test: seed immutable core fixture"], seed)
  const sha = git(["rev-parse", "HEAD"], seed).toString("utf8").trim()
  mkdirSync(cacheRoot)
  const cache = path.join(cacheRoot, sha)
  renameSync(seed, cache)
  return { temp, root: path.join(temp, "consumer"), cacheRoot, cache, sha, selection: provenanceFor(sha) }
}

function verifierFixture(t) {
  const root = path.join(temporary(t), "project")
  write(root, "src/index.ts", 'export const marker = "source"\n')
  write(root, "src/generated/discovery-core/contaminated.ts", "must not enter isolated inputs\n")
  write(root, "package.json", '{"type":"module"}\n')
  write(root, "tsconfig.json", "{}\n")
  write(root, "tsconfig.build.json", "{}\n")
  mkdirSync(path.join(root, "node_modules"))
  write(root, "dist/core-provenance.json", JSON.stringify(provenanceFor(SHA), null, 2) + "\n")
  write(root, "dist/index.js", `export const core = "${SHA}"\n`)
  let observedRoot
  let prepared = 0
  const prepare = ({ root: buildRoot, selection }) => {
    prepared++
    observedRoot = buildRoot
    assert.equal(selection.sha, SHA)
    assert.notEqual(buildRoot, root)
    assert.equal(path.relative(root, buildRoot).startsWith(".."), true)
    assert.equal(existsSync(path.join(buildRoot, "dist")), false)
    assert.equal(existsSync(path.join(buildRoot, "src/generated")), false)
    write(buildRoot, `${GENERATED_PATH}/index.ts`, "export {}\n")
  }
  const compile = (buildRoot, out, selection, toolRoot) => {
    assert.equal(toolRoot, root)
    assert.equal(buildRoot, observedRoot)
    assert.equal(selection.sha, SHA)
    write(out, "core-provenance.json", JSON.stringify(provenanceFor(selection.sha), null, 2) + "\n")
    write(out, "index.js", `export const core = "${selection.sha}"\n`)
  }
  return { root, prepare, compile, observed: () => observedRoot, prepared: () => prepared }
}

test("SHA validation accepts only complete hex and normalizes case", () => {
  assert.equal(validateSHA("A".repeat(40)), SHA)
  for (const value of [undefined, null, "", "main", "a".repeat(39), "g".repeat(40), ` ${SHA}`, `${SHA}\n`, `--${SHA}`, 10]) {
    assert.throws(() => validateSHA(value), /40-character/u)
  }
})

test("selection flags reject ambiguous, empty, or unknown input", () => {
  assert.deepEqual(parseSelectionArgs([]), { mode: "provenance" })
  assert.deepEqual(parseSelectionArgs([], "update"), { mode: "update" })
  assert.deepEqual(parseSelectionArgs([`--sha=${SHA}`]), { mode: "sha", sha: SHA })
  for (const args of [["--sha="], ["--update", "--from-provenance"], ["--out-dir=dist"], ["--sha=main"]]) {
    assert.throws(() => parseSelectionArgs(args))
  }
})

test("invalid explicit SHA fails before creating any cache or generated directory", (t) => {
  const root = temporary(t)
  assert.throws(() => prepareCore({ root, cacheRoot: path.join(root, "cache"),
    selection: { ...provenanceFor(SHA), sha: "../../escape" } }), /40-character/u)
  assert.deepEqual(readdirSync(root), [])
})

test("update resolves main exactly once; selection is immutable across later movement", () => {
  let current = SHA
  let calls = 0
  const resolveMain = () => { calls++; return current }
  const selected = selectCore({ mode: "update", resolveMain })
  current = NEXT_SHA
  assert.equal(selected.sha, SHA)
  assert.equal(calls, 1)
  assert.equal(selectCore({ mode: "update", resolveMain }).sha, NEXT_SHA)
})

test("fixed provenance ignores subsequent main changes and performs no main lookup", (t) => {
  const root = temporary(t)
  write(root, "dist/core-provenance.json", JSON.stringify(provenanceFor(SHA)))
  const resolveMain = () => { throw new Error("main must not be resolved") }
  assert.equal(selectCore({ root, mode: "provenance", resolveMain }).sha, SHA)
  assert.equal(selectCore({ mode: "sha", sha: SHA, resolveMain }).sha, SHA)
})

test("missing or invalid provenance never falls back to main", (t) => {
  const root = temporary(t)
  let calls = 0
  const resolveMain = () => { calls++; return NEXT_SHA }
  assert.throws(() => selectCore({ root, resolveMain }), /provenance/u)
  for (const value of ["not JSON", "null", "[]", "{}", JSON.stringify({ ...provenanceFor(SHA), sha: "main" }),
    JSON.stringify({ ...provenanceFor(SHA), repository: "https://example.invalid/core.git" }),
    JSON.stringify({ ...provenanceFor(SHA), branch: "other" })]) {
    write(root, "dist/core-provenance.json", value)
    assert.throws(() => selectCore({ root, resolveMain }))
  }
  assert.equal(calls, 0)
})

test("clean cache exports public entry, referenced files, and license without rewriting", (t) => {
  const fixture = checkout(t)
  const result = prepareCore(fixture)
  assert.deepEqual(result, fixture.selection)
  const generated = path.join(fixture.root, GENERATED_PATH)
  assert.equal(readFileSync(path.join(generated, "index.ts"), "utf8"), readFileSync(path.join(fixture.cache, "src/index.ts"), "utf8"))
  assert.equal(readFileSync(path.join(generated, "core/value.ts"), "utf8"), "export const value = 1\n")
  assert.equal(readFileSync(path.join(generated, "LICENSE"), "utf8"), "MIT fixture license\n")
  const selectionJSON = readFileSync(path.join(fixture.root, ".tmp/core-selection.json"), "utf8")
  assert.equal(selectionJSON.includes(fixture.temp), false)
  assert.equal(selectionJSON.includes(CORE_REPOSITORY), true)
  assertCleanCheckout(fixture.cache)
})

for (const kind of ["unstaged", "staged", "untracked"]) {
  test(`${kind} cache pollution is rejected without overwriting the cache or prior generated sources`, (t) => {
    const fixture = checkout(t)
    prepareCore(fixture)
    const before = readFileSync(path.join(fixture.root, GENERATED_PATH, "core/value.ts"))
    const filename = kind === "untracked" ? "src/untracked.ts" : "src/core/value.ts"
    write(fixture.cache, filename, "export const polluted = true\n")
    if (kind === "staged") git(["add", filename], fixture.cache)
    const status = git(["status", "--porcelain=v1", "--untracked-files=all"], fixture.cache)
    assert.throws(() => prepareCore(fixture), /Dirty core cache/u)
    assert.deepEqual(git(["status", "--porcelain=v1", "--untracked-files=all"], fixture.cache), status)
    assert.deepEqual(readFileSync(path.join(fixture.root, GENERATED_PATH, "core/value.ts")), before)
    assert.equal(existsSync(`${fixture.cache}.lock`), false)
  })
}

test("ignored worktree source is not copied because export uses Git objects", (t) => {
  const fixture = checkout(t)
  write(fixture.cache, "src/ignored.ts", "export const polluted = true\n")
  assertCleanCheckout(fixture.cache)
  prepareCore(fixture)
  assert.equal(existsSync(path.join(fixture.root, GENERATED_PATH, "ignored.ts")), false)
})

test("wrong cache HEAD is rejected, not reset to disguise the mismatch", (t) => {
  const fixture = checkout(t)
  write(fixture.cache, "src/core/value.ts", "export const value = 2\n")
  git(["add", "."], fixture.cache)
  git(["commit", "--quiet", "-m", "test: move fixture head"], fixture.cache)
  const head = git(["rev-parse", "HEAD"], fixture.cache)
  assert.throws(() => prepareCore(fixture), /does not match/u)
  assert.deepEqual(git(["rev-parse", "HEAD"], fixture.cache), head)
})

test("incomplete cache is not deleted or replaced", (t) => {
  const root = temporary(t)
  const cacheRoot = path.join(root, "cache")
  write(cacheRoot, `${SHA}/keep.txt`, "keep me\n")
  assert.throws(() => prepareCore({ root, cacheRoot, selection: provenanceFor(SHA) }), /Incomplete/u)
  assert.equal(readFileSync(path.join(cacheRoot, SHA, "keep.txt"), "utf8"), "keep me\n")
})

test("committed symlink source is rejected before exporting files", (t) => {
  const fixture = checkout(t)
  symlinkSync("value.ts", path.join(fixture.cache, "src/core/link.ts"))
  git(["add", "."], fixture.cache)
  git(["commit", "--quiet", "-m", "test: add unsupported link"], fixture.cache)
  const sha = git(["rev-parse", "HEAD"], fixture.cache).toString("utf8").trim()
  assert.throws(() => exportCore(fixture.cache, sha, path.join(fixture.root, "export")), /regular Git blobs/u)
  assert.equal(existsSync(path.join(fixture.root, "export")), false)
})

test("normal candidate passes isolated verification and temp inputs are cleaned", (t) => {
  const fixture = verifierFixture(t)
  assert.deepEqual(verifyDistribution(fixture), { sha: SHA, files: 2 })
  assert.equal(fixture.prepared(), 1)
  assert.equal(existsSync(fixture.observed()), false)
  assert.equal(readProvenance(fixture.root).sha, SHA)
})

for (const mutation of ["changed", "missing", "extra", "empty-directory"]) {
  test(`verify rejects ${mutation} candidate without repairing or overwriting it`, (t) => {
    const fixture = verifierFixture(t)
    if (mutation === "changed") write(fixture.root, "dist/index.js", "tampered\n")
    if (mutation === "missing") rmSync(path.join(fixture.root, "dist/index.js"))
    if (mutation === "extra") write(fixture.root, "dist/unexpected.js", "extra\n")
    if (mutation === "empty-directory") mkdirSync(path.join(fixture.root, "dist/empty"))
    const saved = path.join(temporary(t), "saved")
    cpSync(path.join(fixture.root, "dist"), saved, { recursive: true })
    assert.throws(() => verifyDistribution(fixture), /Committed dist mismatch/u)
    compareDistributions(path.join(fixture.root, "dist"), saved)
    assert.equal(existsSync(fixture.observed()), false)
  })
}

test("candidate symlink is rejected before preparing core", (t) => {
  const fixture = verifierFixture(t)
  symlinkSync("index.js", path.join(fixture.root, "dist/link.js"))
  assert.throws(() => verifyDistribution(fixture), /Non-regular/u)
  assert.equal(fixture.prepared(), 0)
})

test("verification stops on missing provenance before preparing or compiling", (t) => {
  const fixture = verifierFixture(t)
  rmSync(path.join(fixture.root, "dist/core-provenance.json"))
  assert.throws(() => verifyDistribution(fixture), /provenance/u)
  assert.equal(fixture.prepared(), 0)
})

for (const flag of ["--assume-unchanged", "--skip-worktree"]) {
  test(`${flag} cannot smuggle modified tracked bytes into the commit export`, (t) => {
    const fixture = checkout(t)
    git(["update-index", flag, "src/core/value.ts"], fixture.cache)
    write(fixture.cache, "src/core/value.ts", "export const value = 999\n")
    assertCleanCheckout(fixture.cache)
    prepareCore(fixture)
    assert.equal(readFileSync(path.join(fixture.root, GENERATED_PATH, "core/value.ts"), "utf8"), "export const value = 1\n")
  })
}

test("legacy facades contain only public-entry and host-adapter reexports", (t) => {
  const fixture = checkout(t)
  prepareCore(fixture)
  const directory = path.join(fixture.root, "src/core")
  assert.deepEqual(readdirSync(directory).sort(), ["build.ts", "capabilities.ts", "litellm.ts", "modelsdev.ts", "protocol.ts"])
  for (const filename of readdirSync(directory)) {
    const text = readFileSync(path.join(directory, filename), "utf8")
    assert.match(text, /^\/\/ Generated/u)
    assert.doesNotMatch(text, /function |class |=>|\.\/core\//u)
    for (const line of text.split("\n").slice(1).filter(Boolean)) assert.match(line, /^export .* from "\.\.\/(?:host|generated\/discovery-core)\//u)
  }
})

test("symlink provenance is rejected rather than read through another workspace", (t) => {
  const fixture = verifierFixture(t)
  const source = path.join(fixture.root, "outside.json")
  renameSync(path.join(fixture.root, "dist/core-provenance.json"), source)
  symlinkSync(source, path.join(fixture.root, "dist/core-provenance.json"))
  assert.throws(() => verifyDistribution(fixture), /provenance/u)
  assert.equal(fixture.prepared(), 0)
})
