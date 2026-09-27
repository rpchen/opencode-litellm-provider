import { cpSync, rmSync } from "node:fs"
import path from "node:path"
import { ROOT, main, parseSelectionArgs, prepareCore, selectCore } from "./prepare-core.mjs"
import { compileDistribution, isolatedBuildRoot, typecheck, unitTest } from "./distribution.mjs"

await main(() => {
  // Resolve once. Isolated generated inputs cannot be replaced by another workspace build.
  const selection = selectCore({ root: ROOT, ...parseSelectionArgs(process.argv.slice(2), "update") })
  const temporary = isolatedBuildRoot(ROOT, true)
  try {
    prepareCore({ root: temporary, selection })
    typecheck(temporary)
    unitTest(temporary)
    // Even a test that mutates generated files cannot change the compiled core input.
    prepareCore({ root: temporary, selection })
    const output = path.join(temporary, "dist")
    compileDistribution(temporary, output, selection)
    // Preserve the old candidate until all validation and compilation have succeeded.
    rmSync(path.join(ROOT, "dist"), { recursive: true, force: true })
    cpSync(output, path.join(ROOT, "dist"), { recursive: true })
    console.log(`build:dist: core ${selection.sha}`)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})
