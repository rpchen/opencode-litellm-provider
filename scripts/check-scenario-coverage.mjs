// Scenario coverage gate: every "#### Scenario: [TAG]" in a change's spec must be referenced by a test.
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

const change = process.argv[2] ?? "add-endpoint-management"
const specFile = path.join("openspec", "changes", change, "specs", "endpoint-management", "spec.md")
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
console.log(JSON.stringify({ change, scenarios: tags.length, covered: tags.length - missing.length, missing }, null, 2))
if (process.argv.includes("--table")) for (const tag of tags) console.log(`| ${tag} | ${evidence[tag].join(", ")} |`)
process.exit(missing.length ? 1 : 0)
