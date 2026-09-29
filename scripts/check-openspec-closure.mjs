import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"

const root = path.resolve(process.env.OPENSPEC_CHANGES_DIR ?? "openspec/changes")
if (!existsSync(root)) process.exit(0)

const completed = []
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === "archive") continue
  const tasks = path.join(root, entry.name, "tasks.md")
  if (!existsSync(tasks)) continue
  const text = readFileSync(tasks, "utf8")
  const checked = [...text.matchAll(/^- \[x\]/gim)].length
  const unchecked = [...text.matchAll(/^- \[ \]/gm)].length
  if (checked > 0 && unchecked === 0) completed.push(entry.name)
}
if (completed.length) {
  console.error("Completed OpenSpec changes must be archived before merge:")
  for (const name of completed) console.error(`- ${name}`)
  process.exit(1)
}
