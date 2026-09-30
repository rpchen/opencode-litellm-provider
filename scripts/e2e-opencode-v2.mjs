import assert from "node:assert/strict"
import { createServer } from "node:http"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawn, spawnSync } from "node:child_process"

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const packageSpec = process.env.E2E_PACKAGE_SPEC
if (!packageSpec || !/^github:rpchen\/opencode-litellm-provider#[0-9a-f]{40}$/u.test(packageSpec)) {
  throw new Error("E2E_PACKAGE_SPEC must pin this repository to a full Git commit")
}
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
  let acceptedRequests = 0
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1")
    if (url.pathname === "/v1/model/info" || url.pathname === "/model/info") {
      if (req.headers.authorization !== `Bearer ${expectedKey}`) {
        res.writeHead(401, { "content-type": "application/json" })
        res.end(JSON.stringify({ error: "unauthorized" }))
        return
      }
      acceptedRequests += 1
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
        acceptedRequests: () => acceptedRequests,
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

function plainTerminal(value) {
  return sanitize(value)
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\\\)/gu, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/\x1B[@-_]/gu, "")
    .replaceAll("\r", "")
}

const activeTuis = new Set()

function startAttachedTui(sessionID) {
  if (process.platform === "win32") {
    throw new Error("real terminal interaction E2E requires a POSIX PTY; CI runs this gate on Ubuntu")
  }
  const probe = spawnSync("script", ["--version"], { encoding: "utf8" })
  if (probe.error || probe.status !== 0) {
    throw new Error(`util-linux script is required for the real terminal E2E: ${probe.error?.message ?? probe.stderr}`)
  }

  const commandLine = `stty cols 120 rows 40; exec opencode --server ${openCodeServer.url} --session ${sessionID}`
  const child = spawn("script", ["-qefc", commandLine, "/dev/null"], {
    cwd: project,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  let exit
  const exited = new Promise((resolve) => {
    exit = resolve
    child.once("exit", (code, signal) => resolve({ code, signal }))
  })
  child.stdout.on("data", (chunk) => { stdout += String(chunk) })
  child.stderr.on("data", (chunk) => { stderr += String(chunk) })

  const tui = {
    child,
    write(value) {
      if (!child.stdin.destroyed) child.stdin.write(value)
    },
    mark() {
      return stdout.length
    },
    output(from = 0) {
      return plainTerminal(stdout.slice(from))
    },
    diagnostics() {
      return {
        stdout: plainTerminal(stdout),
        stderr: plainTerminal(stderr),
      }
    },
    exited,
    resolveExit: exit,
  }
  activeTuis.add(tui)
  return tui
}

async function waitForTui(tui, expected, options = {}) {
  const from = options.from ?? 0
  const timeout = options.timeout ?? 20_000
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const output = tui.output(from)
    if (typeof expected === "string" ? output.includes(expected) : expected.test(output)) return output
    if (tui.child.exitCode !== null) {
      const diagnostic = tui.diagnostics()
      throw new Error(`TUI exited before ${String(expected)} appeared:\n${diagnostic.stdout}\n${diagnostic.stderr}`)
    }
    await sleep(100)
  }
  const diagnostic = tui.diagnostics()
  throw new Error(`timed out waiting for TUI output ${String(expected)}:\n${diagnostic.stdout}\n${diagnostic.stderr}`)
}

async function stopAttachedTui(tui) {
  if (tui.child.exitCode === null) {
    tui.write("\x1b")
    await sleep(50)
    tui.write(":q\r")
    const result = await Promise.race([
      tui.exited,
      sleep(5_000).then(() => undefined),
    ])
    if (!result && tui.child.exitCode === null) tui.child.kill()
  }
  activeTuis.delete(tui)
}

function payload(value) {
  return value && typeof value === "object" && !Array.isArray(value) && "data" in value ? value.data : value
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const defaultMock = await startLiteLLM(secrets[0])
const companyMock = await startLiteLLM(secrets[1])
let openCodeServer

async function dumpFailureDiagnostics() {
  process.stderr.write("\n=== real OpenCode E2E diagnostics ===\n")
  if (openCodeServer) {
    const output = openCodeServer.output()
    process.stderr.write(`--- foreground server stdout ---\n${output.stdout}\n`)
    process.stderr.write(`--- foreground server stderr ---\n${output.stderr}\n`)
    command(["api", "--server", openCodeServer.url, "GET", "/api/plugin"], { allowFailure: true })
  }
  for (const tui of activeTuis) {
    const output = tui.diagnostics()
    process.stderr.write(`--- attached TUI stdout ---\n${output.stdout.slice(Math.max(0, output.stdout.length - 24000))}\n`)
    process.stderr.write(`--- attached TUI stderr ---\n${output.stderr.slice(Math.max(0, output.stderr.length - 24000))}\n`)
  }
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
      package: packageSpec,
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

  // Match the user's real installation path. plugin add performs OpenCode's own
  // Git package install/cache and validates the server entrypoint. Because the
  // same package is already present in our config object, it preserves endpoint options.
  command(["plugin", "add", packageSpec], { timeout: 240_000 })

  openCodeServer = await startOpenCodeServer()
  env.OPENCODE_PASSWORD = openCodeServer.password
  const api = (...args) => command(["api", "--server", openCodeServer.url, ...args])
  const serverCommand = (name, ...args) => command([name, "--server", openCodeServer.url, ...args])

  // Server listen readiness precedes external plugin activation in OpenCode 2.0.16.
  // Wait until the real host has either activated or failed the LiteLLM plugin before
  // asserting integration/provider behavior.
  let litellmPlugin
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = payload(jsonOutput(api("GET", "/api/plugin"), "plugin.list"))
    if (Array.isArray(state)) {
      litellmPlugin = state.find((item) => item.id === "litellm")
      if (litellmPlugin?.state?.status === "active" || litellmPlugin?.state?.status === "failed") break
    }
    await sleep(500)
  }
  assert(litellmPlugin, "LiteLLM server plugin was never discovered by the real OpenCode host")
  assert.equal(litellmPlugin.state?.status, "active",
    `LiteLLM server plugin failed to activate: ${JSON.stringify(litellmPlugin)}`)

  // This is the next regression gate: v0.4.1 reproduces the real host
  // Integration/provider schema failure here, which also empties /connect and /models.
  const integrationsRaw = jsonOutput(api("GET", "/api/integration"), "integration.list")
  const integrations = payload(integrationsRaw)
  assert(Array.isArray(integrations), "integration.list payload must be an array")
  const integrationIds = integrations.map((item) => item.id)
  assert(integrationIds.includes("litellm"), `missing litellm integration: ${JSON.stringify(integrationIds)}`)
  assert(integrationIds.includes("litellm-company"), `missing litellm-company integration: ${JSON.stringify(integrationIds)}`)
  for (const id of ["litellm", "litellm-company"]) {
    const integration = integrations.find((item) => item.id === id)
    const keyMethod = integration?.methods?.find((method) => method.type === "key")
    assert(keyMethod, `${id} must expose a key auth method`)
    assert(!("form" in keyMethod), `${id} fixed-baseUrl key method must omit form instead of emitting form: []`)
  }

  const commands = payload(jsonOutput(api("command.list"), "command.list"))
  assert(Array.isArray(commands), "command.list payload must be an array")
  const commandNames = commands.map((item) => item.name)
  for (const name of ["litellm-endpoints", "litellm-diagnostics", "litellm-audit-export"]) {
    assert(commandNames.includes(name), `missing real host command ${name}: ${JSON.stringify(commandNames)}`)
  }

  // Reproduce the user-visible startup order before any endpoint has a credential:
  // commands are executed while no TUI listener exists, and /models has no LiteLLM namespace yet.
  const createdSession = payload(jsonOutput(
    api("POST", "/api/session", "--data", JSON.stringify({ title: "LiteLLM E2E" })),
    "session.create",
  ))
  assert.equal(typeof createdSession?.id, "string", `session.create did not return an id: ${JSON.stringify(createdSession)}`)
  const sessionID = createdSession.id
  const runSessionCommand = (name, text = "") =>
    api("POST", `/api/session/${sessionID}/command`, "--data", JSON.stringify({ name, text }))

  const beforeConnectModels = command(["models", "--server", openCodeServer.url], { timeout: 120_000 })
  assert.doesNotMatch(beforeConnectModels.stdout, /litellm(?:-company)?\//u,
    "LiteLLM models must stay unpublished until the endpoint has a credential")

  // 1) Diagnostics: emit while no TUI is attached, then require the newly attached TUI
  // to recover the latest diagnostic result without rerunning the command.
  runSessionCommand("litellm-diagnostics")
  let tui = startAttachedTui(sessionID)
  await waitForTui(tui, "LiteLLM Endpoints · active 2/2")
  await stopAttachedTui(tui)

  // 2) Audit export already had latest-state recovery; keep it in the same real-host gate
  // because the user observed all three commands appearing silent during startup.
  runSessionCommand("litellm-audit-export")
  tui = startAttachedTui(sessionID)
  await waitForTui(tui, "LiteLLM 审查报告已导出")
  await stopAttachedTui(tui)

  // 3) Endpoint activation: execute before TUI startup, recover the pending selector,
  // then prove the host-native DOWN + ENTER path toggles the second endpoint.
  runSessionCommand("litellm-endpoints")
  tui = startAttachedTui(sessionID)
  let mark = tui.mark()
  await waitForTui(tui, "LiteLLM endpoints", { from: mark })
  tui.write("\x1b[B")
  tui.write("\r")
  await waitForTui(tui, "○ company", { from: mark })
  tui.write("\x1b")
  await sleep(100)
  await stopAttachedTui(tui)

  // The endpoint toggle above happened before credentials existed. /connect remains independent
  // for both integrations, matching the user's real workflow.
  for (const [id, key] of [["litellm", secrets[0]], ["litellm-company", secrets[1]]]) {
    api("POST", `/api/integration/${id}/connect/key`, "--data", JSON.stringify({ key }))
  }

  const connected = payload(jsonOutput(api("GET", "/api/integration"), "integration.list after connect"))
  for (const id of ["litellm", "litellm-company"]) {
    const integration = connected.find((item) => item.id === id)
    assert.equal(integration?.connections?.length, 1, `${id} must have exactly one independent saved credential connection`)
  }

  serverCommand("reload")

  async function waitForProviders(expected, absent = []) {
    let providers = []
    let lastProviderError = ""
    for (let attempt = 0; attempt < 30; attempt++) {
      const result = command(["api", "--server", openCodeServer.url, "GET", "/api/provider"], {
        allowFailure: true,
        echo: attempt === 29,
      })
      if (result.status === 0) {
        try {
          const value = payload(jsonOutput(result, "provider.list"))
          if (Array.isArray(value)) providers = value
        } catch (error) {
          lastProviderError = String(error)
        }
        const ids = providers.map((item) => item.id)
        if (expected.every((id) => ids.includes(id)) && absent.every((id) => !ids.includes(id))) {
          return providers
        }
      } else {
        lastProviderError = result.stderr || result.stdout
      }
      await sleep(1000)
    }
    throw new Error(`providers did not converge; expected=${JSON.stringify(expected)} absent=${JSON.stringify(absent)} last=${lastProviderError || JSON.stringify(providers.map((item) => item.id))}`)
  }

  // Company was disabled by the real terminal interaction before credentials were entered.
  // Only the default endpoint may discover/publish now.
  let providers = await waitForProviders(["litellm"], ["litellm-company"])
  let providerIds = providers.map((item) => item.id)
  assert(providerIds.includes("litellm"))
  assert(!providerIds.includes("litellm-company"))
  assert(defaultMock.acceptedRequests() > 0, "default fake LiteLLM must receive its authenticated discovery request")
  assert.equal(companyMock.acceptedRequests(), 0, "disabled company endpoint must not discover before it is re-enabled")

  let models = command(["models", "--server", openCodeServer.url], { timeout: 120_000 })
  assert.match(models.stdout, /litellm\//u, "CLI models must include the active default LiteLLM endpoint")
  assert.doesNotMatch(models.stdout, /litellm-company\//u, "CLI models must exclude the disabled company endpoint")

  // Re-enable company through the same real selector. DOWN selects company, ENTER toggles it.
  runSessionCommand("litellm-endpoints")
  tui = startAttachedTui(sessionID)
  mark = tui.mark()
  await waitForTui(tui, "LiteLLM endpoints", { from: mark })
  tui.write("\x1b[B")
  tui.write("\r")
  await waitForTui(tui, "✓ company", { from: mark })
  tui.write("\x1b")
  await sleep(100)
  await stopAttachedTui(tui)

  providers = await waitForProviders(["litellm", "litellm-company"])
  providerIds = providers.map((item) => item.id)
  assert(providerIds.includes("litellm"))
  assert(providerIds.includes("litellm-company"))
  assert(companyMock.acceptedRequests() > 0, "re-enabled company endpoint must receive its own authenticated discovery request")

  models = command(["models", "--server", openCodeServer.url], { timeout: 120_000 })
  assert.match(models.stdout, /litellm\//u, "CLI models must include default LiteLLM models")
  assert.match(models.stdout, /litellm-company\//u, "CLI models must include re-enabled company LiteLLM models")

  // Endpoint-scoped diagnostics must use the real OpenCode command tail (prompt.text).
  // This reproduces /litellm-diagnostics company and rejects the previous silent fallback to overview.
  runSessionCommand("litellm-diagnostics", "company")
  tui = startAttachedTui(sessionID)
  mark = tui.mark()
  // PTY text normalization may collapse the full-width colon, so assert semantic spacing.
  await waitForTui(tui, /Endpoint\s+company/u, { from: mark })
  await waitForTui(tui, /models\.dev\s+ok/u, { from: mark })
  const scopedDiagnostics = tui.output(mark)
  assert.doesNotMatch(scopedDiagnostics, /LiteLLM Endpoints · active \d+\/\d+/u,
    "endpoint-scoped diagnostics must not fall back to the multi-endpoint overview")
  await stopAttachedTui(tui)

  const pluginState = jsonOutput(api("GET", "/api/plugin"), "plugin.list")
  const plugins = payload(pluginState)
  assert(Array.isArray(plugins), "plugin.list payload must be an array")
  assert(plugins.some((item) => item.id === "litellm" && item.state?.status === "active"),
    `server plugin must be active: ${JSON.stringify(plugins.filter((item) => item.id === "litellm"))}`)

  console.log("Real OpenCode 2.0.16 E2E passed: startup recovery, native keyboard activation, endpoint-scoped diagnostics, credentials, providers and models are verified.")
} catch (error) {
  await dumpFailureDiagnostics()
  throw error
} finally {
  for (const tui of activeTuis) {
    if (tui.child.exitCode === null) tui.child.kill()
  }
  activeTuis.clear()
  openCodeServer?.child.kill()
  await Promise.all([
    new Promise((resolve) => defaultMock.server.close(resolve)),
    new Promise((resolve) => companyMock.server.close(resolve)),
  ])
  rmSync(workspace, { recursive: true, force: true })
}
