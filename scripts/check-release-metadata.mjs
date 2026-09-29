import { existsSync, readFileSync } from "node:fs"

const manifest = JSON.parse(readFileSync("package.json", "utf8"))
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"))
const version = manifest.version
const failures = []

if (lock.version !== version) failures.push(`package-lock.json version ${lock.version} != ${version}`)
if (lock.packages?.[""]?.version !== version) {
  failures.push(`package-lock root package version ${lock.packages?.[""]?.version} != ${version}`)
}

const readme = readFileSync("README.md", "utf8")
const current = readme.match(/锁定当前发行版：[\s\S]*?#v(\d+\.\d+\.\d+)/)
if (!current) failures.push("README current-release install example was not found")
else if (current[1] !== version) failures.push(`README current release v${current[1]} != v${version}`)

const notes = `docs/releases/v${version}.md`
if (!existsSync(notes)) failures.push(`missing current release notes: ${notes}`)
if (!readme.includes(`[v${version} release notes](${notes})`)) {
  failures.push(`README does not link current release notes v${version}`)
}

if (failures.length) {
  console.error("Release metadata is inconsistent:")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log(`release metadata ok: v${version}`)
