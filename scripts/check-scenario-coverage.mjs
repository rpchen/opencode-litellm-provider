// Scenario coverage gate: every "#### Scenario: [TAG]" of the capability spec must be referenced by a test.
// Reads the active change's spec when one exists, otherwise the canonical (archived/synced) capability spec.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

const capability = "endpoint-management"
const change = process.argv.find((a, i) => i >= 2 && !a.startsWith("--")) ?? "add-endpoint-management"
const candidates = [
  path.join("openspec", "changes", change, "specs", capability, "spec.md"),
  path.join("openspec", "specs", capability, "spec.md"),
]
const specFile = candidates.find((file) => existsSync(file))
if (!specFile) throw new Error(`no spec found for ${capability}`)
const tags = [...readFileSync(specFile, "utf8").matchAll(/^#### Scenario: \[([A-Z0-9-]+)\]/gmu)].map((m) => m[1])
const files = []
const walk = (dir) => { for (const name of readdirSync(dir)) { const p = path.join(dir, name); statSync(p).isDirectory() ? walk(p) : /\.test\.(ts|mjs)$|e2e-.*\.mjs$/.test(name) && files.push(p) } }
walk("test"); walk("scripts")
const corpus = files.map((f) => [f, readFileSync(f, "utf8")])
const missing = []
const evidence = {}
for (const tag of tags) {
  const hits = corpus.filter(([, text]) => text.includes(`[${tag}]`)).map(([f]) => f)
  evidence[tag] = hits
  if (hits.length === 0) missing.push(tag)
}
console.log(JSON.stringify({ spec: specFile, scenarios: tags.length, covered: tags.length - missing.length, missing }, null, 2))
if (process.argv.includes("--table")) for (const tag of tags) console.log(`| ${tag} | ${evidence[tag].join(", ")} |`)
process.exit(missing.length ? 1 : 0)
