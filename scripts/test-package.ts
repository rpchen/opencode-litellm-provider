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
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    name: string
    version: string
    scripts?: Record<string, string>
    workspaces?: unknown
  }
  const preparationScripts = [
    "postinstall",
    "build",
    "preinstall",
    "install",
    "prepack",
    "prepare",
  ]
  const preparationTrigger = preparationScripts.find((name) => manifest.scripts?.[name])
  if (manifest.workspaces || preparationTrigger) {
    throw new Error(
      `package would trigger Git dependency preparation: ${preparationTrigger ?? "workspaces"}`,
    )
  }

  const packed = JSON.parse(
    run(npm, ["pack", "--json", "--pack-destination", packages], root),
  ) as Array<{ filename: string; files: Array<{ path: string }> }>
  const result = packed[0]
  if (!result) throw new Error("npm pack did not report an artifact")

  const files = new Set(result.files.map((file) => file.path.replaceAll("\\", "/")))
  const required = [
    "package.json", "README.md", "LICENSE", "dist/index.js", "dist/index.d.ts",
    "dist/tui.js", "dist/tui.d.ts", "dist/tui-card.js", "dist/tui-actions.js",
  ]
  const missing = required.filter((file) => !files.has(file))
  if (missing.length > 0) throw new Error(`package is missing required files: ${missing.join(", ")}`)
  const cardSource = readFileSync(path.join(root, "dist", "tui-card.js"), "utf8")
  if (!cardSource.includes('from "solid-js"') || cardSource.includes("solid-js/dist/")) {
    throw new Error("TUI must share the host's Solid runtime through the bare module specifier")
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
    const tui = await import(${JSON.stringify(`${manifest.name}/tui`)})
    if (plugin.PLUGIN_ID !== "litellm" || !plugin.default || tui.default?.id !== "litellm") {
      throw new Error("package exports are invalid")
    }
    const { createAuditResultStore } = await import(new URL(
      "./node_modules/${manifest.name}/dist/tui-card.js", import.meta.url,
    ))
    const store = createAuditResultStore()
    store.accept({ sequence: 1, sessionID: "smoke", ok: true, path: "C:/audit/report.json", error: "" })
    if (store.forSession("smoke")?.path !== "C:/audit/report.json") {
      throw new Error("TUI result card did not load")
    }
    const { PROTOCOL_PACKAGES } = await import(new URL(
      "./node_modules/${manifest.name}/dist/core/protocol.js", import.meta.url,
    ))
    const expected = {
      chat: "@opencode/ai/providers/openai-compatible",
      responses: "@opencode/ai/providers/openai/responses",
      messages: "@opencode/ai/providers/anthropic",
    }
    if (JSON.stringify(PROTOCOL_PACKAGES) !== JSON.stringify(expected)) {
      throw new Error("model SDK packages do not match host built-ins")
    }
    for (const sdkPackage of Object.values(expected)) {
      const implementation = await import(sdkPackage)
      if (!implementation) throw new Error("SDK entry point did not load")
    }
    const { createRegistrationView } = await import(new URL(
      "./node_modules/${manifest.name}/dist/host/register.js", import.meta.url,
    ))
    const provider = createRegistrationView([], "https://example.invalid/v1")
    if (provider.info.package !== expected.chat) {
      throw new Error("provider SDK package does not match host built-in")
    }
  `
  run(process.execPath, ["--input-type=module", "--eval", probe], consumer)

  console.log(`Package smoke passed: ${result.filename}`)
} finally {
  rmSync(workspace, { recursive: true, force: true })
}
