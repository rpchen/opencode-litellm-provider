import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, GENERATED_PATH, main, readProvenance } from "./prepare-core.mjs"
import { compareDistributions } from "./distribution.mjs"

function snapshot(directory, prefix = "") {
  return readdirSync(directory).sort().flatMap((name) => {
    const file = path.join(directory, name)
    const relative = `${prefix}${name}`
    return statSync(file).isDirectory()
      ? [`${relative}/`, ...snapshot(file, `${relative}/`)]
      : [`${relative}:${createHash("sha256").update(readFileSync(file)).digest("hex")}`]
  })
}

await main(() => {
  const selection = readProvenance(ROOT)
  const original = snapshot(path.join(ROOT, "dist"))
  const consumer = mkdtempSync(path.join(os.tmpdir(), "opencode-clean-build-"))
  const execute = (script, args = [], expectedFailure = false) => {
    const result = spawnSync(process.execPath, [path.join(consumer, "scripts", script), ...args], {
      cwd: consumer, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
      // Fixed verification must not use an ambient SHA instead of its provenance.
      env: { ...process.env, LITELLM_CORE_SHA: "0".repeat(40) },
    })
    if (result.error) throw new Error("Could not start isolated distribution verification")
    if (expectedFailure) {
      assert.notEqual(result.status, 0, "tampered distribution must fail verification")
      assert.match(result.stderr, /Committed dist mismatch/u, "failure must be a dist mismatch, not a build/network error")
    } else if (result.status !== 0) {
      const diagnostics = `${result.stdout}\n${result.stderr}`
        .replaceAll(consumer, "<isolated-build>").replaceAll(ROOT, "<workspace>").replaceAll(os.homedir(), "<home>")
      throw new Error(`Isolated distribution command failed:\n${diagnostics}`)
    }
  }
  try {
    for (const directory of ["src", "test", "scripts", "dist"]) {
      cpSync(path.join(ROOT, directory), path.join(consumer, directory), {
        recursive: true,
        filter: (source) => source !== path.join(ROOT, "src", "core")
          && source !== path.join(ROOT, "src", "generated"),
      })
    }
    for (const name of ["package.json", "tsconfig.json", "tsconfig.build.json"]) {
      cpSync(path.join(ROOT, name), path.join(consumer, name))
    }
    symlinkSync(path.join(ROOT, "node_modules"), path.join(consumer, "node_modules"), "junction")
    assert.equal(existsSync(path.join(consumer, GENERATED_PATH)), false)
    assert.equal(existsSync(path.join(consumer, "src", "core")), false)
    assert.equal(existsSync(path.join(consumer, ".tmp")), false)
    // Real locked tsc and Bun tests; a fresh core cache, no sibling checkout or pre-generated source.
    execute("build.mjs", ["--from-provenance"])
    compareDistributions(path.join(ROOT, "dist"), path.join(consumer, "dist"))
    execute("verify-dist.mjs")
    for (const kind of ["changed", "missing", "extra"]) {
      rmSync(path.join(consumer, "dist"), { recursive: true, force: true })
      cpSync(path.join(ROOT, "dist"), path.join(consumer, "dist"), { recursive: true })
      const entry = path.join(consumer, "dist", "index.js")
      if (kind === "changed") writeFileSync(entry, readFileSync(entry, "utf8") + "\n// tampered\n")
      if (kind === "missing") rmSync(entry)
      if (kind === "extra") writeFileSync(path.join(consumer, "dist", "unexpected.js"), "export {}\n")
      const before = snapshot(path.join(consumer, "dist"))
      execute("verify-dist.mjs", [], true)
      assert.deepEqual(snapshot(path.join(consumer, "dist")), before, "verifier must not repair its candidate")
    }
    assert.deepEqual(snapshot(path.join(ROOT, "dist")), original, "integration tests must not mutate the real distribution")
    console.log(`Distribution integration passed: clean fixed build, normal verification, changed/missing/extra rejection; core ${selection.sha}`)
  } finally {
    rmSync(consumer, { recursive: true, force: true })
  }
})
