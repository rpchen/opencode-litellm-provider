import assert from "node:assert/strict"
import { createServer } from "node:http"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawn, spawnSync } from "node:child_process"

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const packageSpec = process.env.E2E_PACKAGE_SPEC
// CI pins the GitHub commit. Local pre-push verification may pin a local clone with git+file://...#<sha>;
// OpenCode's own installer still installs it, but the commit must be a full immutable SHA either way.
if (!packageSpec || !/^(github:rpchen\/opencode-litellm-provider|git\+file:\/\/\/\S+)#[0-9a-f]{40}$/u.test(packageSpec)) {
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

function startLiteLLM(initialKey) {
  let acceptedRequests = 0
  const keys = { expected: initialKey }
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1")
    if (url.pathname === "/v1/model/info" || url.pathname === "/model/info") {
      if (req.headers.authorization !== `Bearer ${keys.expected}`) {
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
        keys,
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
      // When OPENCODE_PASSWORD is already set the server does not print a generated one.
      const password = stdout.match(/server password (\S+)/u)?.[1] ?? env.OPENCODE_PASSWORD
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

function lastScreenText(tui, from = 0) {
  const text = tui.output(from).replace(/[┃╹▀╻╺╸]+/gu, " ").replace(/\s{2,}/gu, " | ")
  return text.slice(-1400)
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
  throw new Error(`timed out waiting for TUI output ${String(expected)}; last screen text: ${lastScreenText(tui, from)}`)
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

const DETAIL = (active, connected = false) => [
  active ? "停用" : "启用",
  "修改 Base URL",
  connected ? "替换 API Key" : "连接 API Key",
  ...(connected ? ["断开凭据"] : []),
  "删除 endpoint",
  "返回",
]

// main list -> endpoint detail -> toggle -> back; every key is preceded by an on-screen anchor check.
async function endpointDetailToggle(tui, listLabel, { expectAfter, connected, wasActive, since }) {
  const main = ["＋ 新增 endpoint", "全部启用", "全部停用", "✓ default", listLabel]
  await choose(tui, main, listLabel, { since })
  const opened = tui.mark() // detail screen is painted after the ENTER above
  const detail = DETAIL(wasActive, connected)
  await choose(tui, detail, detail[0], { anchor: new RegExp(`company[^|]*${wasActive ? "已启用" : "未启用"}`, "u"), since: since })
  await waitForTui(tui, expectAfter, { from: opened })
  await choose(tui, DETAIL(!wasActive, connected), "返回", { anchor: expectAfter, since: opened })
  await waitForTui(tui, wasActive ? "○ company" : "✓ company", { from: opened })
}

// Drive the real TUI selector: press DOWN until the wanted option is the highlighted one, then ENTER.
// Matching is on the rendered screen text after each key, so a fake (non-interactive) menu cannot pass.
async function choose(tui, labelsInOrder, target, { anchor, since } = {}) {
  const index = labelsInOrder.indexOf(target)
  if (index < 0) throw new Error(`option ${target} not in ${JSON.stringify(labelsInOrder)}`)
  // Never send keys before the dialog is on screen: stray keys would land in the session prompt.
  await waitForTui(tui, anchor ?? target, { from: since ?? 0 })
  await sleep(400)
  for (let i = 0; i < index; i++) {
    tui.write("\x1b[B")
    await sleep(150)
  }
  const pressed = tui.mark()
  tui.write("\r")
  await sleep(600)
  return pressed
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

  // 3) Endpoint activation: execute before TUI startup, recover the pending selector, then prove
  // the host-native DOWN + ENTER path opens the endpoint detail and toggles it (main list -> detail -> toggle -> back).
  runSessionCommand("litellm-endpoints")
  tui = startAttachedTui(sessionID)
  let mark = tui.mark()
  await waitForTui(tui, "LiteLLM endpoints", { from: mark })
  await waitForTui(tui, "＋ 新增 endpoint", { from: mark })
  await endpointDetailToggle(tui, "✓ company", { expectAfter: /company[^|]*未启用/u, connected: false, wasActive: true, since: mark })
  tui.write("\x1b")
  await sleep(300)
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

  // Re-enable company through the same real selector (main list -> detail -> enable -> back).
  runSessionCommand("litellm-endpoints")
  tui = startAttachedTui(sessionID)
  mark = tui.mark()
  await waitForTui(tui, "LiteLLM endpoints", { from: mark })
  await waitForTui(tui, "○ company", { from: mark })
  await endpointDetailToggle(tui, "○ company", { expectAfter: /company[^|]*已启用/u, connected: true, wasActive: false, since: mark })
  tui.write("\x1b")
  await sleep(300)
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

  // ===== Phase 2: Endpoint Management UX over the real TUI (file-declared options, real PTY keys) =====
  await stopAttachedTui(tui).catch(() => {})
  openCodeServer.child.kill()
  await sleep(1500)

  const mgmtA = await startLiteLLM("sk-mgmt-one")
  const mgmtB = await startLiteLLM("sk-mgmt-two")
  try {
    secrets.push("sk-mgmt-one", "sk-mgmt-two", "sk-mgmt-three")
    // The config FILE is the only source of plugin options now (no OPENCODE_CONFIG_CONTENT), with comments and
    // fields the UI does not manage; "company" is a bystander that must survive every UI write untouched.
    delete env.OPENCODE_CONFIG_CONTENT
    const handWritten = `{
  // my own notes: the UI must not delete these
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "${packageSpec}",
      "options": {
        "pollInterval": 30,
        "futureOption": { "keep": ["me"] },
        "endpoints": {
          // the company endpoint is untouched by this test
          "company": { "baseUrl": "${companyMock.baseUrl}", "protocolOverrides": { "demo-model": "chat" }, "mine": true }
        }
      }
    }
  ]
}
`
    writeFileSync(opencodeConfigFile, handWritten)
    const readConfig = () => readFileSync(opencodeConfigFile, "utf8")
    const parsedOptions = () => JSON.parse(readConfig().replace(/^\s*\/\/.*$/gmu, "")).plugins[0].options

    openCodeServer = await startOpenCodeServer()
    env.OPENCODE_PASSWORD = openCodeServer.password
    let plugin2
    for (let attempt = 0; attempt < 60; attempt++) {
      const state = payload(jsonOutput(api("GET", "/api/plugin"), "plugin.list"))
      plugin2 = Array.isArray(state) ? state.find((item) => item.id === "litellm") : undefined
      if (plugin2?.state?.status === "active" || plugin2?.state?.status === "failed") break
      await sleep(500)
    }
    assert.equal(plugin2?.state?.status, "active", `phase 2 plugin failed to activate: ${JSON.stringify(plugin2)}`)
    const session2 = payload(jsonOutput(api("POST", "/api/session", "--data", JSON.stringify({ title: "LiteLLM mgmt E2E" })), "session.create")).id
    const run2 = (name, text = "") => api("POST", `/api/session/${session2}/command`, "--data", JSON.stringify({ name, text }))
    const integrationsNow = () => payload(jsonOutput(api("GET", "/api/integration"), "integration.list"))
    const connectionsOf = (id) => integrationsNow().find((item) => item.id === id)?.connections ?? []
    const providerIds = () => payload(jsonOutput(api("GET", "/api/provider"), "provider.list")).map((item) => item.id)
    const waitProviders = async (expected, absent = []) => {
      for (let attempt = 0; attempt < 40; attempt++) {
        const ids = providerIds()
        if (expected.every((id) => ids.includes(id)) && absent.every((id) => !ids.includes(id))) return ids
        await sleep(1000)
      }
      throw new Error(`providers did not converge: expected=${expected} absent=${absent} now=${providerIds()}`)
    }
    const type = async (tui2, value) => { for (const ch of value) { tui2.write(ch); await sleep(15) } await sleep(200) }
    const clear = async (tui2, length) => { for (let i = 0; i < length; i++) { tui2.write("\x7f"); await sleep(10) } }

    // company already has a credential (saved in phase 1, independent of anything the UI does): take its baseline
    const companyBaseline = connectionsOf("litellm-company").map((c) => c.id).sort()
    assert(companyBaseline.length >= 1, "bystander endpoint must start with a credential")

    // --- open the management center in the real TUI, recovering the pending request after attach ---
    run2("litellm-endpoints")
    const t = startAttachedTui(session2)
    let m = t.mark()
    await waitForTui(t, "＋ 新增 endpoint", { from: m })
    await waitForTui(t, "company", { from: m })

    // 1. ADD (ID + Base URL only) -> inactive / not connected; nothing discovered yet
    const mainList = (items) => ["＋ 新增 endpoint", "全部启用", "全部停用", ...items]
    m = await choose(t, mainList(["✓ company"]), "＋ 新增 endpoint", { since: m })
    await waitForTui(t, /新增\s*\S*：/u, { from: m })
    await type(t, "e2e-new"); m = t.mark(); t.write("\r")
    await waitForTui(t, /Base\s*URL/u, { from: m })
    await type(t, mgmtA.baseUrl); m = t.mark(); t.write("\r")
    await waitForTui(t, /e2e-new[^|]*未启用 · 未连接/u, { from: m })
    let options = parsedOptions()
    assert.equal(options.endpoints["e2e-new"]?.baseUrl, mgmtA.baseUrl, "Add did not write the endpoint into the config file")
    assert.equal(options.futureOption?.keep?.[0], "me", "Add lost an unknown option")
    assert.deepEqual(options.endpoints.company, { baseUrl: companyMock.baseUrl, protocolOverrides: { "demo-model": "chat" }, mine: true }, "Add touched the bystander endpoint")
    assert(readConfig().includes("// my own notes: the UI must not delete these") && readConfig().includes("// the company endpoint is untouched by this test"), "Add removed user comments")
    assert.equal(mgmtA.acceptedRequests(), 0, "creating an endpoint must not trigger discovery")
    assert(integrationsNow().some((item) => item.id === "litellm-e2e-new"), "new endpoint is not a /connect integration after rebuild")
    assert.equal(connectionsOf("litellm-e2e-new").length, 0, "new endpoint must have no credential")
    assert(!providerIds().includes("litellm-e2e-new"), "inactive new endpoint exposed a provider")

    // 2. CONNECT (Not connected -> Connected) on the inactive endpoint; activation untouched
    const L = (...rest) => mainList(["✓ company", ...rest])
    m = await choose(t, L("○ e2e-new"), "○ e2e-new", { since: m })
    let detail = DETAIL(false, false)
    m = await choose(t, detail, "连接 API Key", { anchor: /e2e-new[^|]*未启用 · 未连接/u, since: m })
    await waitForTui(t, /连接\s*\S*\s*的\s*API/u, { from: m })
    await type(t, "sk-mgmt-one")
    const beforeSubmit = t.mark()
    t.write("\r")
    await waitForTui(t, /e2e-new[^|]*未启用 · 已连接/u, { from: beforeSubmit })
    assert.equal(connectionsOf("litellm-e2e-new").length, 1, "Connect did not store a credential through the host")
    assert(!providerIds().includes("litellm-e2e-new"), "Connect must not activate the endpoint")
    const afterConnect = t.mark()
    await sleep(800)
    assert(!t.output(afterConnect).includes("sk-mgmt-one"), "the API key was echoed after submit")
    m = beforeSubmit

// [ACT-IMMEDIATE]
    // 3. ACTIVATE -> provider + models appear; discovery used the connected key
    detail = DETAIL(false, true)
    await choose(t, detail, "启用", { anchor: /e2e\S*[^|]*未启用 · 已连接/u, since: m })
    await waitProviders(["litellm-e2e-new"])
    assert(mgmtA.acceptedRequests() > 0, "activation did not trigger authenticated discovery")
    let models = command(["models", "--server", openCodeServer.url], { timeout: 120_000 })
    assert.match(models.stdout, /litellm-e2e-new\//u, "activated endpoint's models are not listed")

    // 4. hand edit while running: add advanced field + comment, then EDIT Base URL through the UI
    writeFileSync(opencodeConfigFile, readConfig().replace(`"e2e-new": { "baseUrl": "${mgmtA.baseUrl}" }`, `"e2e-new": { "baseUrl": "${mgmtA.baseUrl}", "protocolOverrides": { "demo-model": "responses" }, "hand": "written" }`))
    if (!parsedOptions().endpoints["e2e-new"].hand) {
      // the writer may have reformatted the entry over several lines
      const c = readConfig()
      writeFileSync(opencodeConfigFile, c.replace(/("e2e-new":\s*\{\s*"baseUrl":\s*"[^"]+")/u, '$1, "protocolOverrides": { "demo-model": "responses" }, "hand": "written"'))
    }
    assert.equal(parsedOptions().endpoints["e2e-new"].hand, "written", "test setup could not hand-edit the config")
    // same key is valid on the second mock so the edited address discovers successfully with the stored credential
    mgmtB.keys.expected = "sk-mgmt-one"
    const bBefore = mgmtB.acceptedRequests()
    detail = DETAIL(true, true)
    m = await choose(t, detail, "修改 Base URL", { anchor: /e2e\S*[^|]*已启用 · 已连接/u, since: m })
    await waitForTui(t, "ID 不可修改", { from: m })
    await clear(t, mgmtA.baseUrl.length + 5)
    await type(t, mgmtB.baseUrl)
    m = t.mark()
    t.write("\r")
    await waitForTui(t, /e2e-new[^|]*已启用 · 已连接/u, { from: m })
    options = parsedOptions()
    assert.equal(options.endpoints["e2e-new"].baseUrl, mgmtB.baseUrl, "Edit did not write the new Base URL")
    assert.equal(options.endpoints["e2e-new"].hand, "written", "Edit dropped a hand-written field")
    assert.deepEqual(options.endpoints["e2e-new"].protocolOverrides, { "demo-model": "responses" }, "Edit dropped protocolOverrides")
    assert.deepEqual(options.endpoints.company, { baseUrl: companyMock.baseUrl, protocolOverrides: { "demo-model": "chat" }, mine: true }, "Edit touched the bystander")
    assert(readConfig().includes("// my own notes: the UI must not delete these"), "Edit removed user comments")
    for (let i = 0; i < 40 && mgmtB.acceptedRequests() <= bBefore; i++) await sleep(500)
    assert(mgmtB.acceptedRequests() > bBefore, "the edited Base URL was never used for discovery")
    models = command(["models", "--server", openCodeServer.url], { timeout: 120_000 })
    assert.match(models.stdout, /litellm-e2e-new\//u, "edited endpoint lost its models")

    // 5. REPLACE key (credential count stays 1, old key gone) — mock B only accepts the new key
    mgmtB.keys.expected = "sk-mgmt-two" // the replaced key is the only one the mock accepts
    m = await choose(t, DETAIL(true, true), "替换 API Key", { anchor: /e2e\S*[^|]*已启用 · 已连接/u, since: m })
    await waitForTui(t, /替换\s*\S*\s*的\s*API/u, { from: m })
    await type(t, "sk-mgmt-two")
    m = t.mark()
    t.write("\r")
    await waitForTui(t, /e2e-new[^|]*已启用 · 已连接/u, { from: m })
    assert.equal(connectionsOf("litellm-e2e-new").length, 1, "Replace must overwrite, leaving exactly one credential")

    // 6. DISCONNECT (confirm dialog): credential gone, endpoint + activation stay
    m = await choose(t, DETAIL(true, true), "断开凭据", { anchor: /e2e\S*[^|]*已启用 · 已连接/u, since: m })
    await waitForTui(t, /仅删除[^|]*已保存的\s*API/u, { from: m })
    m = t.mark()
    t.write("\r") // default focus = Confirm (probed on the real TUI)
    await waitForTui(t, /e2e-new[^|]*已启用 · 未连接/u, { from: m })
    assert.equal(connectionsOf("litellm-e2e-new").length, 0, "Disconnect left a credential behind")
    assert(parsedOptions().endpoints["e2e-new"], "Disconnect removed the endpoint definition")
    assert.deepEqual(connectionsOf("litellm-company").map((c) => c.id).sort(), companyBaseline, "Disconnect touched another endpoint's credential")

    // 7. CONNECT again, then DEACTIVATE
    m = await choose(t, DETAIL(true, false), "连接 API Key", { anchor: /e2e\S*[^|]*已启用 · 未连接/u, since: m })
    await waitForTui(t, /连接\s*\S*\s*的\s*API/u, { from: m })
    await type(t, "sk-mgmt-two")
    m = t.mark()
    t.write("\r")
    await waitForTui(t, /e2e-new[^|]*已启用 · 已连接/u, { from: m })
    await choose(t, DETAIL(true, true), "停用", { anchor: /e2e\S*[^|]*已启用 · 已连接/u, since: m })
    await waitForTui(t, /e2e-new[^|]*未启用 · 已连接/u, { from: m })
    await waitProviders([], ["litellm-e2e-new"])
    assert.equal(connectionsOf("litellm-e2e-new").length, 1, "Deactivate removed the credential")

    // 8. DELETE (confirm): definition, credential and provider all go; company keeps everything
    m = await choose(t, DETAIL(false, true), "删除 endpoint", { anchor: /e2e\S*[^|]*未启用 · 已连接/u, since: m })
    await waitForTui(t, "将彻底删除", { from: m })
    m = t.mark()
    t.write("\r")
    await waitForTui(t, /已删除\s*endpoint/u, { from: m })
    options = parsedOptions()
    assert(!("e2e-new" in options.endpoints), "Delete left the endpoint definition")
    assert.equal(connectionsOf("litellm-e2e-new").length, 0, "Delete left the credential")
    assert.deepEqual(options.endpoints.company, { baseUrl: companyMock.baseUrl, protocolOverrides: { "demo-model": "chat" }, mine: true }, "Delete touched the bystander")
    assert.equal(options.futureOption.keep[0], "me")
    assert(readConfig().includes("// my own notes: the UI must not delete these"), "Delete removed user comments")
    assert.deepEqual(connectionsOf("litellm-company").map((c) => c.id).sort(), companyBaseline, "Delete removed another endpoint's credential")
    assert(!providerIds().includes("litellm-e2e-new"), "deleted endpoint still has a provider")
    t.write("\x1b")
    await sleep(300)
    await stopAttachedTui(t)

    // 9. RESTART OpenCode: nothing resurrects; the bystander is intact; hand edits show up in the UI
    openCodeServer.child.kill()
    await sleep(2000)
    openCodeServer = await startOpenCodeServer()
    env.OPENCODE_PASSWORD = openCodeServer.password
    for (let attempt = 0; attempt < 60; attempt++) {
      const state = payload(jsonOutput(api("GET", "/api/plugin"), "plugin.list"))
      const item = Array.isArray(state) ? state.find((entry) => entry.id === "litellm") : undefined
      if (item?.state?.status === "active") break
      await sleep(500)
    }
    const ids = integrationsNow().map((item) => item.id)
    assert(!ids.includes("litellm-e2e-new"), "deleted endpoint resurrected after restart")
    assert(ids.includes("litellm-company"), "bystander endpoint lost after restart")
    assert.deepEqual(connectionsOf("litellm-company").map((c) => c.id).sort(), companyBaseline, "bystander credential lost after restart")
    assert(!providerIds().includes("litellm-e2e-new"), "deleted endpoint's provider resurrected")
    const editedAgain = readConfig().replace(/("endpoints":\s*\{)/u, `$1 "hand-added": { "baseUrl": "${mgmtA.baseUrl}" },`)
    writeFileSync(opencodeConfigFile, editedAgain)
    const session3 = payload(jsonOutput(api("POST", "/api/session", "--data", JSON.stringify({ title: "LiteLLM mgmt restart" })), "session.create")).id
    api("POST", `/api/session/${session3}/command`, "--data", JSON.stringify({ name: "litellm-endpoints", text: "" }))
    const t3 = startAttachedTui(session3)
    const m3 = t3.mark()
    await waitForTui(t3, "＋ 新增 endpoint", { from: m3 })
    await waitForTui(t3, "hand-added", { from: m3 })
    assert(!t3.output(m3).includes("e2e-new"), "deleted endpoint is listed after restart")
    t3.write("\x1b")
    await sleep(300)
    await stopAttachedTui(t3)
    console.log("Real OpenCode 2.0.16 endpoint management E2E passed: add/connect/activate/edit/replace/disconnect/deactivate/delete + restart through real TUI dialogs")
  } finally {
    await Promise.all([
      new Promise((resolve) => mgmtA.server.close(resolve)),
      new Promise((resolve) => mgmtB.server.close(resolve)),
    ])
  }

  // ===== Phase 3: legacy single-endpoint start (real /connect credential) → management + migration =====
  await stopAttachedTui(tui).catch(() => {})
  openCodeServer.child.kill()
  await sleep(1500)

  const legacyMock = await startLiteLLM("sk-legacy-start")
  const legacyTarget = await startLiteLLM("sk-legacy-target")
  try {
    secrets.push("sk-legacy-start", "sk-legacy-target", "sk-legacy-replaced")
    // Legacy shape: NO explicit endpoints. The address lives in the /connect credential (its key method
    // carries a required url form field), plus a top-level protocolOverrides and comments the UI must keep.
    const legacyConfig = `{
  // phase 3: legacy single-endpoint configuration
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "${packageSpec}",
      "options": {
        "pollInterval": 30,
        "futureOption": { "keep": ["legacy"] },
        "protocolOverrides": { "demo-model": "chat" }
      }
    }
  ]
}
`
    writeFileSync(opencodeConfigFile, legacyConfig)
    const readLegacy = () => readFileSync(opencodeConfigFile, "utf8")
    const legacyOptions = () => JSON.parse(readLegacy().replace(/^\s*\/\/.*$/gmu, "")).plugins[0].options

    openCodeServer = await startOpenCodeServer()
    env.OPENCODE_PASSWORD = openCodeServer.password
    for (let attempt = 0; attempt < 60; attempt++) {
      const state = payload(jsonOutput(api("GET", "/api/plugin"), "plugin.list"))
      const item = Array.isArray(state) ? state.find((entry) => entry.id === "litellm") : undefined
      if (item?.state?.status === "active") break
      await sleep(500)
    }

    // 2. Real /connect equivalent: the host's own key-connect API, answering the legacy url form.
    const integrationsNow = () => payload(jsonOutput(api("GET", "/api/integration"), "integration.list"))
    const connectionsOf = (id) => integrationsNow().find((item) => item.id === id)?.connections ?? []
    const type = async (tui2, value) => { for (const ch of value) { tui2.write(ch); await sleep(15) } await sleep(200) }
    const clear = async (tui2, length) => { for (let i = 0; i < length; i++) { tui2.write("\x7f"); await sleep(10) } }

    // earlier phases share the data dir, so compare credential ids as a delta
    const beforeConnectIds = connectionsOf("litellm").map((c) => c.id)
    api("POST", "/api/integration/litellm/connect/key", "--data", JSON.stringify({
      key: "sk-legacy-start",
      answer: { url: legacyMock.baseUrl },
    }))
    const allConnectIds = connectionsOf("litellm").map((c) => c.id)
    const legacyConnectId = allConnectIds.filter((id) => !beforeConnectIds.includes(id))
    assert.equal(legacyConnectId.length, 1, `legacy /connect must save one new credential (before=${beforeConnectIds} after=${allConnectIds})`)
    assert(integrationsNow().some((i) => i.id === "litellm"), "legacy litellm integration must exist")

    const legacySession = payload(jsonOutput(api("POST", "/api/session", "--data", JSON.stringify({ title: "LiteLLM legacy mgmt" })), "session.create")).id
    api("POST", `/api/session/${legacySession}/command`, "--data", JSON.stringify({ name: "litellm-endpoints", text: "" }))

    // 3. management UI opens the legacy default (with its connected address)
    const tl = startAttachedTui(legacySession)
    let ml = tl.mark()
    await waitForTui(tl, "＋ 新增 endpoint", { from: ml })
    await waitForTui(tl, /default[^|]*已连接/u, { from: ml })
    assert(legacyOptions().endpoints === undefined, "test setup must start in legacy mode")

    // phase 2 left an explicit activation selection; enable everything first (the legacy default row is
    // inactive until then, and an inactive endpoint still keeps its /connect integration).
    ml = await choose(tl, ["＋ 新增 endpoint", "全部启用", "全部停用", "○ default"], "全部启用", { since: ml })
    await waitForTui(tl, /default[^|]*已启用 · 已连接/u, { from: ml })

    // 4. credential management through the UI: Replace first migrates (confirm), then saves the new key
    ml = await choose(tl, ["＋ 新增 endpoint", "全部启用", "全部停用", "✓ default"], "✓ default", { since: ml })
    const legacyDetail = ["停用", "修改 Base URL", "替换 API Key", "断开凭据", "删除 endpoint", "返回"]
    ml = await choose(tl, legacyDetail, "替换 API Key", { anchor: /default[^|]*已启用 · 已连接/u, since: ml })
    await waitForTui(tl, /迁移为可管理配置/u, { from: ml })
    ml = tl.mark()
    tl.write("\r") // Confirm on the migration dialog (default focus, probed on the real TUI)
    await waitForTui(tl, /替换\s*\S*\s*的\s*API/u, { from: ml })
    await type(tl, "sk-legacy-replaced")
    ml = tl.mark()
    tl.write("\r")
    await waitForTui(tl, /default[^|]*已启用 · 已连接/u, { from: ml })
    const afterMigrate = legacyOptions()
    assert.equal(afterMigrate.endpoints?.default?.baseUrl, legacyMock.baseUrl, "migration must materialise the connected address")
    assert.deepEqual(afterMigrate.endpoints.default.protocolOverrides, { "demo-model": "chat" }, "migration must move protocolOverrides")
    assert.equal(afterMigrate.protocolOverrides, undefined, "migration must remove the top-level protocolOverrides")
    assert.equal(afterMigrate.futureOption.keep[0], "legacy", "migration lost an unknown option")
    assert(readLegacy().includes("// phase 3: legacy single-endpoint configuration"), "migration removed user comments")
    const migratedIds = connectionsOf("litellm").map((c) => c.id)
    assert.equal(migratedIds.length, 1, "Replace must overwrite, leaving exactly one credential")
    assert.notDeepEqual(migratedIds, legacyConnectId, "Replace must install a new credential")
    assert(integrationsNow().some((i) => i.id === "litellm"), "migration must keep integration id litellm")

    // 5. Edit Base URL through the UI → provider/models use the new address
    legacyTarget.keys.expected = "sk-legacy-replaced"
    const targetBefore = legacyTarget.acceptedRequests()
    const oldUrlBefore = legacyMock.acceptedRequests() // discovery legitimately ran on the old address before the edit
    ml = await choose(tl, legacyDetail, "修改 Base URL", { anchor: /default[^|]*已启用 · 已连接/u, since: ml })
    await waitForTui(tl, /ID\s*不可修改/u, { from: ml })
    await clear(tl, legacyMock.baseUrl.length + 5)
    await type(tl, legacyTarget.baseUrl)
    ml = tl.mark()
    tl.write("\r")
    await waitForTui(tl, /default[^|]*已启用 · 已连接/u, { from: ml })
    assert.equal(legacyOptions().endpoints.default.baseUrl, legacyTarget.baseUrl, "Edit must update the migrated Base URL")
    assert.deepEqual(legacyOptions().endpoints.default.protocolOverrides, { "demo-model": "chat" }, "Edit dropped protocolOverrides")
    assert(readLegacy().includes("// phase 3: legacy single-endpoint configuration"), "Edit removed user comments")
    for (let i = 0; i < 40 && legacyTarget.acceptedRequests() <= targetBefore; i++) await sleep(500)
    assert(legacyTarget.acceptedRequests() > targetBefore, "the edited Base URL was never used for discovery")
    assert.equal(legacyMock.acceptedRequests(), oldUrlBefore, "the migrated endpoint must not query the old address after the edit")

    // 7. Delete through the UI (definition + credential go)
    ml = await choose(tl, legacyDetail, "删除 endpoint", { anchor: /default[^|]*已启用 · 已连接/u, since: ml })
    await waitForTui(tl, /将彻底删除/u, { from: ml })
    ml = tl.mark()
    tl.write("\r") // Confirm (default focus)
    await waitForTui(tl, /已删除\s*endpoint/u, { from: ml })
    assert(!("default" in legacyOptions().endpoints), "Delete left the endpoint definition")
    assert.equal(connectionsOf("litellm").length, 0, "Delete left the legacy credential")
    tl.write("\x1b")
    await sleep(300)
    await stopAttachedTui(tl)

    // 8-9. restart: the deleted legacy endpoint does not resurrect
    openCodeServer.child.kill()
    await sleep(2000)
    openCodeServer = await startOpenCodeServer()
    env.OPENCODE_PASSWORD = openCodeServer.password
    for (let attempt = 0; attempt < 60; attempt++) {
      const state = payload(jsonOutput(api("GET", "/api/plugin"), "plugin.list"))
      const item = Array.isArray(state) ? state.find((entry) => entry.id === "litellm") : undefined
      if (item?.state?.status === "active") break
      await sleep(500)
    }
    assert.equal(connectionsOf("litellm").length, 0, "deleted legacy endpoint resurrected after restart")
    const legacySession2 = payload(jsonOutput(api("POST", "/api/session", "--data", JSON.stringify({ title: "LiteLLM legacy restart" })), "session.create")).id
    api("POST", `/api/session/${legacySession2}/command`, "--data", JSON.stringify({ name: "litellm-endpoints", text: "" }))
    const tl2 = startAttachedTui(legacySession2)
    const ml2 = tl2.mark()
    await waitForTui(tl2, "＋ 新增 endpoint", { from: ml2 })
    assert(!tl2.output(ml2).includes("default"), "deleted legacy endpoint is still listed after restart")
    tl2.write("\x1b")
    await sleep(300)
    await stopAttachedTui(tl2)
    console.log("Real OpenCode 2.0.16 legacy endpoint management E2E passed: real /connect credential, migration, Edit, Delete + restart")
  } finally {
    await Promise.all([
      new Promise((resolve) => legacyMock.server.close(resolve)),
      new Promise((resolve) => legacyTarget.server.close(resolve)),
    ])
  }

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
  // A just-killed OpenCode may still be writing its cache: never let cleanup mask the real result.
  await sleep(1000)
  try { rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }) } catch (error) {
    process.stderr.write(`cleanup skipped: ${error.code ?? error.message}\n`)
  }
}
