import { main } from "./prepare-core.mjs"
import { verifyDistribution } from "./distribution.mjs"

await main(() => {
  if (process.argv.length !== 2) throw new Error("verify:dist accepts no selection override; it always uses committed provenance")
  const result = verifyDistribution()
  console.log(`verify:dist: ${result.files} files match core ${result.sha}`)
})
