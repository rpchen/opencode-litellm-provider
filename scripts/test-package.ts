import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = realpathSync(fileURLToPath(new URL("..", import.meta.url)))
const workspace = mkdtempSync(path.join(os.tmpdir(), "opencode-package-contract-"))
const packages = path.join(workspace, "packages")
const consumer = path.join(workspace, "consumer")
const npm = process.platform === "win32" ? "npm.cmd" : "npm"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// Do not inherit module-resolution shortcuts, user npm credentials, or preload hooks.
const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" }
for (const name of Object.keys(env)) {
  if (["NODE_PATH", "NODE_OPTIONS", "BUN_OPTIONS"].includes(name.toUpperCase())
      || ["npm_config_userconfig", "npm_config_globalconfig", "npm_config_cache"].includes(name.toLowerCase())) delete env[name]
}
env.npm_config_userconfig = path.join(workspace, "npmrc")
env.npm_config_globalconfig = path.join(workspace, "npmrc-global")
env.npm_config_cache = path.join(workspace, "npm-cache")

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, {
    cwd, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"],
    timeout: 240_000, maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) {
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
      .replaceAll(workspace, "<external-consumer>").replaceAll(root, "<workspace>").replaceAll(os.homedir(), "<home>")
    process.stderr.write(output)
    throw new Error(`Package contract command failed with exit code ${result.status ?? "unknown"}`)
  }
  return result.stdout
}

try {
  const relative = path.relative(root, realpathSync(workspace))
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new Error("Package consumer must be outside the source workspace; use an external system temporary directory")
  }
  mkdirSync(packages)
  mkdirSync(consumer)
  writeFileSync(env.npm_config_userconfig, "registry=https://registry.npmjs.org/\n")
  writeFileSync(env.npm_config_globalconfig, "")
  const manifest: unknown = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
  if (!isRecord(manifest) || typeof manifest.name !== "string" || typeof manifest.version !== "string"
      || !isRecord(manifest.devDependencies)) throw new Error("Invalid package manifest")
  const peerVersion = manifest.devDependencies["@opencode/plugin"]
  if (typeof peerVersion !== "string" || !/^\d+\.\d+\.\d+$/u.test(peerVersion)) {
    throw new Error("Isolated consumer requires an explicit, fixed host peer version")
  }
  const preparationScripts = ["postinstall", "build", "preinstall", "install", "prepack", "prepare", "preprepare", "postprepare"]
  const scripts = isRecord(manifest.scripts) ? manifest.scripts : {}
  const preparationTrigger = preparationScripts.find((name) => scripts[name])
  if (manifest.workspaces !== undefined || preparationTrigger) {
    throw new Error(`package would trigger Git dependency preparation: ${preparationTrigger ?? "workspaces"}`)
  }
  const packed: unknown = JSON.parse(run(npm, ["pack", "--ignore-scripts", "--json", "--pack-destination", packages], root))
  const artifact: unknown = Array.isArray(packed) ? packed[0] : undefined
  if (!isRecord(artifact) || typeof artifact.filename !== "string" || !Array.isArray(artifact.files)
      || path.basename(artifact.filename) !== artifact.filename) throw new Error("npm pack did not report a valid artifact")
  const files = new Set(artifact.files.map((file: unknown) => {
    if (!isRecord(file) || typeof file.path !== "string") throw new Error("Invalid packed file list")
    return file.path.replaceAll("\\", "/")
  }))
  const required = [
    "package.json", "README.md", "LICENSE", "dist/index.js", "dist/index.d.ts", "dist/tui.js", "dist/tui.d.ts",
    "dist/tui-card.js", "dist/tui-actions.js", "dist/core-provenance.json", "dist/host/models.js",
    "dist/generated/discovery-core/index.js", "dist/generated/discovery-core/index.d.ts", "dist/generated/discovery-core/LICENSE",
  ]
  const missing = required.filter((file) => !files.has(file))
  if (missing.length) throw new Error(`Package is missing required files: ${missing.join(", ")}`)
  if ([...files].some((file) => /^(?:src|scripts|\.tmp|\.git)\//u.test(file))) {
    throw new Error("Package must not ship source or build-cache fallbacks")
  }
  const cardSource = readFileSync(path.join(root, "dist", "tui-card.js"), "utf8")
  if (!cardSource.includes('from "solid-js"') || cardSource.includes("solid-js/dist/")) {
    throw new Error("TUI must share the host's Solid runtime through the bare module specifier")
  }
  const distributionDigests = Object.fromEntries([...files].filter((file) => file.startsWith("dist/")).map((file) => [
    file, createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex"),
  ]))
  const remote = process.env.PACKAGE_SPEC
  if (remote !== undefined && !/^github:rpchen\/opencode-litellm-provider#(?:[0-9a-f]{40}|v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/u.test(remote)) {
    throw new Error("Remote package probe requires a fixed commit or version tag in this repository")
  }
  writeFileSync(path.join(consumer, "package.json"), JSON.stringify({
    name: "isolated-opencode-provider-consumer", private: true, type: "module",
  }, null, 2) + "\n")
  run(npm, ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false",
    remote ?? path.join(packages, artifact.filename), `@opencode/plugin@${peerVersion}`], consumer)
  cpSync(path.join(root, "scripts", "installed-consumer.mjs"), path.join(consumer, "probe.mjs"))
  writeFileSync(path.join(consumer, "verification-input.json"), JSON.stringify({
    name: manifest.name, version: manifest.version, peerVersion, distributionDigests,
    litellm: JSON.parse(readFileSync(path.join(root, "test/fixtures/litellm-model-info.json"), "utf8")),
    modelsDev: JSON.parse(readFileSync(path.join(root, "test/fixtures/models-dev.json"), "utf8")),
  }) + "\n")
  const probeOutput = run(process.execPath, [path.join(consumer, "probe.mjs")], consumer)
  process.stdout.write(probeOutput)
  console.log(`Package contract passed: ${remote ?? artifact.filename}; lifecycle scripts disabled`)
} finally {
  rmSync(workspace, { recursive: true, force: true })
}
