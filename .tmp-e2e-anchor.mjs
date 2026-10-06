import fs from "node:fs"
const p = "scripts/e2e-opencode-v2.mjs"
let s = fs.readFileSync(p, "utf8")
const old = `  const identityADiagnostics = await diagnosticsThroughTui(
    /withheld[\s：:]*invalid-fields/u,
    "the identity A baseline",
  )`
if (!s.includes(old)) throw new Error("identity A anchor missing")
// Scenario A serves a single model, so anchor on its own publication counts
// instead of a fixture model that is not served in this round.
s = s.replace(old, `  const identityADiagnostics = await diagnosticsThroughTui(
    /发现 1 · 可用 1 · withheld 0/u,
    "the identity A publication",
  )`)
fs.writeFileSync(p, s)
console.log("identity A anchor fixed")
