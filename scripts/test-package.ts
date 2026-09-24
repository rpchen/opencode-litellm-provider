import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = fileURLToPath(new URL("..", import.meta.url))
const workspace = path.join(root, ".tmp", "package-smoke")
const packages = path.join(workspace, "packages")
const consumer = path.join(workspace, "consumer")
const npm = process.platform === "win32" ? "npm.cmd" : "npm"

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "")
    process.stderr.write(result.stderr ?? "")
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`)
  }
  return result.stdout
}

rmSync(workspace, { recursive: true, force: true })
mkdirSync(packages, { recursive: true })
mkdirSync(consumer, { recursive: true })

try {
  const packed = JSON.parse(
    run(npm, ["pack", "--json", "--pack-destination", packages], root),
  ) as Array<{ filename: string; files: Array<{ path: string }> }>
  const result = packed[0]
  if (!result) throw new Error("npm pack did not report an artifact")

  const files = new Set(result.files.map((file) => file.path.replaceAll("\\", "/")))
  const required = ["package.json", "README.md", "LICENSE", "dist/index.js", "dist/index.d.ts"]
  const missing = required.filter((file) => !files.has(file))
  if (missing.length > 0) throw new Error(`package is missing required files: ${missing.join(", ")}`)

  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    name: string
    version: string
  }
  const tarball = path.join(packages, result.filename)
  writeFileSync(
    path.join(consumer, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
  )
  run(
    npm,
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", tarball],
    consumer,
  )

  const probe = `
    import { readFile } from "node:fs/promises"
    const installed = JSON.parse(await readFile(
      new URL("./node_modules/${manifest.name}/package.json", import.meta.url),
      "utf8",
    ))
    if (installed.version !== ${JSON.stringify(manifest.version)}) {
      throw new Error("installed version mismatch")
    }
    const plugin = await import(${JSON.stringify(manifest.name)})
    if (plugin.PLUGIN_ID !== "litellm" || !plugin.default) {
      throw new Error("package exports are invalid")
    }
  `
  run(process.execPath, ["--input-type=module", "--eval", probe], consumer)

  console.log(`Package smoke passed: ${result.filename}`)
} finally {
  rmSync(workspace, { recursive: true, force: true })
}
