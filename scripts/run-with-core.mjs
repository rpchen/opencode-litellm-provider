import { main, prepareCore, readProvenance, selectCore } from "./prepare-core.mjs"
import { run, typecheck, unitTest } from "./distribution.mjs"

await main(() => {
  const task = process.argv[2]
  if (process.argv.length !== 3 || !["typecheck", "test"].includes(task)) throw new Error("Expected typecheck or test")
  const selection = process.env.LITELLM_CORE_SHA
    ? selectCore({ mode: "sha", sha: process.env.LITELLM_CORE_SHA })
    : readProvenance()
  prepareCore({ selection })
  if (task === "typecheck") typecheck()
  else {
    unitTest()
    run(process.execPath, ["--test", "--test-concurrency=1", "scripts/check-openspec-closure.test.mjs", "scripts/codebase-memory.test.mjs", "scripts/codebase-memory-main.test.mjs"])
  }
})
