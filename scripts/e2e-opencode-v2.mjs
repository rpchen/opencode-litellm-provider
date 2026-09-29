import assert from "node:assert/strict"
import { createServer } from "node:http"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawn, spawnSync } from "node:child_process"

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const fixture = JSON.parse(readFileSync(path.join(root, "test/fixtures/litellm-model-info.json"), "utf8"))
const workspace = mkdtempSync(path.join(os.tmpdir(), "opencode-v2-real-e2e-"))
const project = path.join(workspace, "project")
const home = path.join(workspace, "home")
const config = path.join(workspace, "config")
const data = path.join(workspace, "data")
const cache = path.join(workspace, "cache")
const state = path.join(workspace, "state")
const opencodeConfig = path.join(config, "opencode")
const opencodeConfigFile = path.join(opencodeConfig, "opencode.jsonc")
for (const dir of [project, home, config, data, cache, state, opencodeConfig]) mkdirSync(dir, { recursive: true })

const secrets = ["sk-e2e-default", "sk-e2e-company"]
const sanitize = (value) => secrets.reduce((text, secret) => text.replaceAll(secret, "***"), String(value))

function startLiteLLM(expectedKey) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1")
    if (url.pathname === "/v1/model/info" || url.pathname === "/model/info") {
      if (req.headers.authorization !== `Bearer ${expectedKey}`) {
        res.writeHead(401, { "content-type": "application/json" })
        res.end(JSON.stringify({ error: "unauthorized" }))
        return
      }
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify(fixture))
      return
    }
    res.writeHead(404, { "content-type": "application/json" })
    res.end(JSON.stringify({ error: "not found" }))
  })
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") return reject(new Error("mock LiteLLM did not bind TCP"))
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
      })
    })
  })
}

const env = {
  ...process.env,
  HOME: home,
  XDG_CONFIG_HOME: config,
  XDG_DATA_HOME: data,
  XDG_CACHE_HOME: cache,
  XDG_STATE_HOME: state,
  OPENCODE_DISABLE_AUTOUPDATE: "1",
  NO_COLOR: "1",
}
delete env.OPENCODE_SERVER
env.OPENCODE_CONFIG = opencodeConfigFile

function command(args, options = {}) {
  const result = spawnSync("opencode", args, {
    cwd: project,
    env,
    encoding: "utf8",
    timeout: options.timeout ?? 120_000,
    maxBuffer: 32 * 1024 * 1024,
  })
  const stdout = sanitize(result.stdout ?? "")
  const stderr = sanitize(result.stderr ?? "")
  if (options.echo !== false) {
    process.stdout.write(`$ opencode ${args.join(" ")}\n`)
    if (stdout) process.stdout.write(stdout)
    if (stderr) process.stderr.write(stderr)
  }
  if (!options.allowFailure && (result.error || result.status !== 0)) {
    throw new Error(`opencode exited ${result.status ?? "unknown"}: ${result.error?.message ?? (stderr || stdout)}`)
  }
  return { status: result.status, stdout, stderr }
}

function jsonOutput(result, label) {
  const text = result.stdout.trim()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${label} did not return JSON: ${text || result.stderr}`)
  }
}

function startOpenCodeServer() {
  return new Promise((resolve, reject) => {
    const child = spawn("opencode", ["serve", "--hostname", "127.0.0.1", "--port", "0"], {
      cwd: project,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let settled = false
    const deadline = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new Error(`real OpenCode server did not become ready:\n${sanitize(stdout)}\n${sanitize(stderr)}`))
    }, 30_000)

    const inspect = () => {
      if (settled) return
      const url = stdout.match(/server listening on (http:\/\/\S+)/u)?.[1]
      const password = stdout.match(/server password (\S+)/u)?.[1]
      if (!url || !password) return
      settled = true
      clearTimeout(deadline)
      resolve({
        child,
        url,
        password,
        output: () => ({ stdout: sanitize(stdout), stderr: sanitize(stderr) }),
      })
    }
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk)
      inspect()
    })
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })
    child.once("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      reject(error)
    })
    child.once("exit", (code) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      reject(new Error(`real OpenCode server exited ${code}:\n${sanitize(stdout)}\n${sanitize(stderr)}`))
    })
  })
}

function payload(value) {
  return value && typeof value === "object" && !Array.isArray(value) && "data" in value ? value.data : value
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const defaultMock = await startLiteLLM(secrets[0])
const companyMock = await startLiteLLM(secrets[1])

async function dumpFailureDiagnostics() {
  process.stderr.write("\n=== real OpenCode E2E diagnostics ===\n")
  command(["debug", "config"], { allowFailure: true })
  const logResult = command(["debug", "paths", "log"], { allowFailure: true, echo: false })
  const logPath = logResult.stdout.trim()
  if (logPath && existsSync(logPath)) {
    const files = statSync(logPath).isDirectory()
      ? readdirSync(logPath).map((name) => path.join(logPath, name)).filter((file) => statSync(file).isFile())
      : [logPath]
    for (const file of files.sort()) {
      const content = sanitize(readFileSync(file, "utf8"))
      process.stderr.write(`--- ${file.replaceAll(workspace, "<e2e>")} ---\n`)
      process.stderr.write(content.slice(Math.max(0, content.length - 24000)))
      process.stderr.write("\n")
    }
  } else {
    process.stderr.write(`No OpenCode log path found: ${sanitize(logPath)}\n`)
  }
}

try {
  const e2eConfig = {
    $schema: "https://opencode.ai/config.json",
    plugins: [{
      package: root,
      options: {
        pollInterval: 30,
        endpoints: {
          default: { baseUrl: defaultMock.baseUrl },
          company: { baseUrl: companyMock.baseUrl },
        },
      },
    }],
  }
  writeFileSync(opencodeConfigFile, JSON.stringify(e2eConfig, null, 2) + "\n")
  env.OPENCODE_CONFIG_CONTENT = JSON.stringify(e2eConfig)
  env.OPENCODE_CONFIG_PROJECT_DISABLE = "1"

  const version = command(["--version"]).stdout.trim()
  assert.match(version, /2\.0\.16/u, `real host must be pinned to OpenCode 2.0.16, got ${version}`)

  const server = await startOpenCodeServer()
  env.OPENCODE_PASSWORD = server.password
  const api = (...args) => command(["api", "--server", server.url, ...args])
  const serverCommand = (name, ...args) => command([name, "--server", server.url, ...args])

  // This is the first regression gate: v0.4.1 should reproduce the real host
  // Integration/provider failure here, before /connect or /models can succeed.
  const integrationsRaw = jsonOutput(api("GET", "/api/integration"), "integration.list")
  const integrations = payload(integrationsRaw)
  assert(Array.isArray(integrations), "integration.list payload must be an array")
  const integrationIds = integrations.map((item) => item.id)
  assert(integrationIds.includes("litellm"), `missing litellm integration: ${JSON.stringify(integrationIds)}`)
  assert(integrationIds.includes("litellm-company"), `missing litellm-company integration: ${JSON.stringify(integrationIds)}`)

  for (const [id, key] of [["litellm", secrets[0]], ["litellm-company", secrets[1]]]) {
    api("POST", `/api/integration/${id}/connect/key`, "--data", JSON.stringify({ key }))
  }

  serverCommand("reload")

  let providers = []
  let lastProviderError = ""
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = command(["api", "--server", server.url, "GET", "/api/provider"], { allowFailure: true, echo: attempt === 29 })
    if (result.status === 0) {
      try {
        const value = payload(jsonOutput(result, "provider.list"))
        if (Array.isArray(value)) providers = value
      } catch (error) {
        lastProviderError = String(error)
      }
      const ids = providers.map((item) => item.id)
      if (ids.includes("litellm") && ids.includes("litellm-company")) break
    } else {
      lastProviderError = result.stderr || result.stdout
    }
    await sleep(1000)
  }

  const providerIds = providers.map((item) => item.id)
  assert(providerIds.includes("litellm"), `litellm provider never became available: ${lastProviderError || JSON.stringify(providerIds)}`)
  assert(providerIds.includes("litellm-company"), `litellm-company provider never became available: ${lastProviderError || JSON.stringify(providerIds)}`)

  const models = command(["models", "--server", server.url], { timeout: 120_000 })
  assert.match(models.stdout, /litellm\//u, "CLI models must include default LiteLLM models")
  assert.match(models.stdout, /litellm-company\//u, "CLI models must include company LiteLLM models")

  const pluginState = jsonOutput(api("GET", "/api/plugin"), "plugin.list")
  const plugins = payload(pluginState)
  assert(Array.isArray(plugins), "plugin.list payload must be an array")
  assert(plugins.some((item) => item.id === "litellm" && item.state?.status === "active"),
    `server plugin must be active: ${JSON.stringify(plugins.filter((item) => item.id === "litellm"))}`)

  console.log("Real OpenCode 2.0.16 E2E passed: plugin, integrations, credentials, providers and models are visible.")
  server.child.kill()
} catch (error) {
  await dumpFailureDiagnostics()
  throw error
} finally {
  await Promise.all([
    new Promise((resolve) => defaultMock.server.close(resolve)),
    new Promise((resolve) => companyMock.server.close(resolve)),
  ])
  rmSync(workspace, { recursive: true, force: true })
}
