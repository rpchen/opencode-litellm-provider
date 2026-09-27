import { main, prepareCore, readProvenance } from "./prepare-core.mjs"
import { typecheck, unitTest } from "./distribution.mjs"

await main(() => {
  const task = process.argv[2]
  if (process.argv.length !== 3 || !["typecheck", "test"].includes(task)) throw new Error("Expected typecheck or test")
  const selection = readProvenance()
  prepareCore({ selection })
  if (task === "typecheck") typecheck()
  else unitTest()
})
