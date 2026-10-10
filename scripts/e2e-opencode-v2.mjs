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
// Preserve the existing lifecycle input while the selected complete catalog
// records below provide model capabilities. Do not mutate shared fixtures.
const FULL_CAPABILITY_DECLARATIONS = {
  supports_function_calling: true,
  supports_reasoning: false,
  supports_vision: false,
  supports_pdf_input: false,
  supports_audio_input: false,
  supports_video_input: false,
  supports_audio_output: false,
}
const servedFixture = structuredClone(fixture)
const declare = (modelName, overrides = {}) => {
  const row = servedFixture.data.find((entry) => entry.model_name === modelName)
  assert(row, `fixture must contain ${modelName}`)
  Object.assign(row.model_info, FULL_CAPABILITY_DECLARATIONS, overrides)
}
for (const modelName of ["claude-db", "claude-bedrock", "anthropic-direct", "multi-endpoint-model"]) declare(modelName)
// Toggle-style reasoning: supported, but with no selectable levels.
declare("glm-5.3", { supports_reasoning: true })
// qwen3.7-plus only lacks a reasoning verdict in the registry fixture; declaring
// the toggle-style support makes it publishable and keeps the withheld list
// inside the diagnostics card's rendered window (5 entries), so every withheld
// reason under test — including shared-route — stays assertable on screen.
declare("qwen3.7-plus", { supports_reasoning: true })
let servedModels = servedFixture.data
let mockFailStatus = 0
// [REAL-HOST-E2E] Runtime Identity expectations come from the candidate checkout itself:
// the installed package is built from this commit, so its identity must match these files.
const candidateIdentity = JSON.parse(readFileSync(path.join(root, "dist", "runtime-identity.json"), "utf8"))
const candidateProvenance = JSON.parse(readFileSync(path.join(root, "dist", "core-provenance.json"), "utf8"))
assert.equal(candidateIdentity.coreCommit, candidateProvenance.sha, "candidate identity coreCommit must match provenance")
assert.match(candidateIdentity.artifactDigest, /^sha256:[0-9a-f]{64}$/u, "candidate identity digest must be valid")
const expectedPluginVersion = candidateIdentity.pluginVersion
const expectedShortDigest = candidateIdentity.artifactDigest.slice("sha256:".length, "sha256:".length + 8)
const expectedShortCore = candidateIdentity.coreCommit.slice(0, 8)
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

// Fixed public records and complete synthetic records for existing lifecycle cases.
const frozenDiscovery = JSON.parse(readFileSync(path.join(root,"test/fixtures/metadata-priority/synthetic-discovery.json"),"utf8"))
const frozenCatalog = JSON.parse(readFileSync(path.join(root,"test/fixtures/metadata-priority/modelsdev-subset.json"),"utf8"))
const oracle = JSON.parse(readFileSync(path.join(root,"test/fixtures/metadata-priority/expected-16.json"),"utf8"))
const baselineCatalog = structuredClone(frozenCatalog)
const addRecord = (name, context, output, reasoning = false, reasoning_options = []) => {
  const canonical = "e2e/"+name
  const record = {id:name,canonical_model_id:canonical,limit:{context,output},tool_call:true,reasoning,reasoning_options,modalities:{input:["text"],output:["text"]}}
  baselineCatalog.models[canonical] = structuredClone(record)
  baselineCatalog.providers.e2e ??= {models:{}}
  baselineCatalog.providers.e2e.models[name] = record
}
for(const row of servedFixture.data) {
  const name = row.model_name
  if(!name || oracle.models.some(model=>model.id===name) || ["shared-route","invalid-fields","minimax-m3"].includes(name))continue
  if(baselineCatalog.providers.e2e?.models[name])continue
  const context = typeof row.model_info.max_input_tokens === "number" ? row.model_info.max_input_tokens : 128000
  const output = typeof row.model_info.max_output_tokens === "number" ? row.model_info.max_output_tokens : 16000
  addRecord(name,context,output,row.model_info.supports_reasoning===true)
}
addRecord("invalid-fields",0,0)
addRecord("minimax-m3",1000000,131072);delete baselineCatalog.providers.e2e.models["minimax-m3"].reasoning
addRecord("e2e-no-effort",32000,4096,true)
addRecord("e2e-disabled",32000,4096,false)
addRecord("e2e-messages",200000,64000,true,[{type:"budget_tokens",max:64000}])
let currentCatalog = structuredClone(baselineCatalog)
const catalogueEntries = () => currentCatalog

function startCatalogServer() {
  const bodies = new Map([
    ["/catalog.json", () => JSON.stringify(catalogueEntries())],
  ])
  let requests = 0
  let failures = 0
  let outage = false
  const server = createServer((req, res) => {
    const body = bodies.get(req.url ?? "")
    if (body && outage) {
      // A genuine models.dev catalog outage: the deterministic source answers
      // its canonical paths with a server error instead of a stale body.
      failures += 1
      res.writeHead(500, { "content-type": "application/json" })
      res.end(JSON.stringify({ detail: "injected models.dev outage" }))
      return
    }
    if (body) {
      requests += 1
      res.writeHead(200, { "content-type": "application/json" })
      res.end(body())
      return
    }
    res.writeHead(404, { "content-type": "application/json" })
    res.end(JSON.stringify({ error: "not found" }))
  })
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") return reject(new Error("catalog server did not bind TCP"))
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}/catalog.json`,
        requests: () => requests,
        failures: () => failures,
        setOutage: (flag) => { outage = flag },
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

const secrets = ["sk-e2e-default", "sk-e2e-company"]
const sanitize = (value) => secrets.reduce((text, secret) => text.replaceAll(secret, "***"), String(value))

function startLiteLLM(initialKey) {
  let acceptedRequests = 0
  let failedRequests = 0
  const keys = { expected: initialKey }
  const modelRequests = []
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1")
    if (url.pathname === "/v1/model/info" || url.pathname === "/model/info") {
      if (req.headers.authorization !== `Bearer ${keys.expected}`) {
        res.writeHead(401, { "content-type": "application/json" })
        res.end(JSON.stringify({ error: "unauthorized" }))
        return
      }
      if (mockFailStatus) {
        // [REAL-HOST-E2E] An injected outage must surface as a metadata failure
        // instead of silently republishing pseudo-complete models.
        failedRequests += 1
        res.writeHead(mockFailStatus, { "content-type": "application/json" })
        res.end(JSON.stringify({ error: "injected metadata failure" }))
        return
      }
      acceptedRequests += 1
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ data: servedModels }))
      return
    }
    if (req.method === "POST" && ["/v1/chat/completions","/v1/responses","/v1/messages"].includes(url.pathname)) {
      assert(req.headers.authorization === `Bearer ${keys.expected}` || req.headers["x-api-key"] === keys.expected,"actual request credential mismatch")
      let raw=""; for await (const chunk of req) raw+=chunk
      const body=JSON.parse(raw);modelRequests.push({path:url.pathname,body})
      res.writeHead(200,{"content-type":"text/event-stream"})
      const event=data=>res.write(`data: ${JSON.stringify(data)}\n\n`)
      if(url.pathname==="/v1/responses") {
        const item={id:"msg_e2e",type:"message",role:"assistant",status:"completed",content:[{type:"output_text",text:"ok",annotations:[]}]}
        const response={id:"resp_e2e",object:"response",status:"completed",model:body.model,output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}
        event({type:"response.created",response:{...response,status:"in_progress",output:[]}})
        event({type:"response.output_item.added",output_index:0,item:{...item,status:"in_progress",content:[]}})
        event({type:"response.content_part.added",item_id:item.id,output_index:0,content_index:0,part:{type:"output_text",text:"",annotations:[]}})
        event({type:"response.output_text.delta",item_id:item.id,output_index:0,content_index:0,delta:"ok"})
        event({type:"response.output_item.done",output_index:0,item})
        event({type:"response.completed",response})
      } else if(url.pathname==="/v1/messages") {
        for(const data of [
          {type:"message_start",message:{id:"msg_e2e",type:"message",role:"assistant",model:body.model,content:[],usage:{input_tokens:1,output_tokens:0}}},
          {type:"content_block_start",index:0,content_block:{type:"text",text:""}},
          {type:"content_block_delta",index:0,delta:{type:"text_delta",text:"ok"}},
          {type:"content_block_stop",index:0},
          {type:"message_delta",delta:{stop_reason:"end_turn",stop_sequence:null},usage:{output_tokens:1}},
          {type:"message_stop"}])res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`)
      } else {
        event({id:"chat_e2e",object:"chat.completion.chunk",created:1,model:body.model,choices:[{index:0,delta:{role:"assistant",content:"ok"},finish_reason:null}]})
        event({id:"chat_e2e",object:"chat.completion.chunk",created:1,model:body.model,choices:[{index:0,delta:{},finish_reason:"stop"}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})
        res.write("data: [DONE]\n\n")
      }
      res.end();return
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
        requests: modelRequests,
        acceptedRequests: () => acceptedRequests,
        failedRequests: () => failedRequests,
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
// [REAL-HOST-E2E] The trusted-publication gate must not depend on an external
// catalog. The server process runs the plugin, and its runtime honours these proxy
// variables, so models.dev stays unreachable there while the local fake LiteLLM
// endpoints keep working through NO_PROXY. CLI/TUI processes keep the clean env:
// they only talk to the local server (and `plugin add` must still download the
// candidate from GitHub).
const offlineEnv = {
  ...env,
  HTTP_PROXY: "http://127.0.0.1:1",
  HTTPS_PROXY: "http://127.0.0.1:1",
  NO_PROXY: "127.0.0.1,localhost",
}
delete env.OPENCODE_SERVER
env.OPENCODE_CONFIG = opencodeConfigFile

/** Synchronous sleep so the retry loop stays inside spawnSync-based helpers. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function command(args, options = {}) {
  const attempts = options.retries ?? 1
  for (let attempt = 1; ; attempt += 1) {
    const result = spawnSync("opencode", args, {
      cwd: project,
      env,
      encoding: "utf8",
      timeout: options.timeout ?? 120_000,
      maxBuffer: 33554432,
    })
    const stdout = sanitize(result.stdout ?? "")
    const stderr = sanitize(result.stderr ?? "")
    const transportFailure = (result.error || result.status !== 0) &&
      /Could not reach server|timed out|Transport:/u.test(stdout + stderr)
    if (attempt < attempts && transportFailure) {
      // The real host's own CLI client uses a short HTTP timeout while the server
      // is still starting its filesystem watchers: a transient transport failure
      // is not a plugin failure.
      if (options.echo !== false) process.stdout.write("$ opencode " + args.join(" ") + " (retry " + attempt + "/" + attempts + ")\n")
      sleepSync(2_000)
      continue
    }
    if (options.echo !== false) {
      process.stdout.write("$ opencode " + args.join(" "))
      process.stdout.write("\n")
      if (stdout) process.stdout.write(stdout)
      if (stderr) process.stderr.write(stderr)
    }
    if (!options.allowFailure && (result.error || result.status !== 0)) {
      throw new Error("opencode exited " + (result.status ?? "unknown") + ": " + (result.error?.message ?? (stderr || stdout)))
    }
    return { status: result.status, stdout, stderr }
  }
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
      env: offlineEnv,
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

  // A tall PTY keeps model details and Runtime Identity visible;
  // block at the bottom must stay inside the painted viewport.
  const commandLine = `stty cols 120 rows 100; exec opencode --server ${openCodeServer.url} --session ${sessionID}`
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

const DETAIL = (active, connected = false, canRetry = false) => [
  active ? "停用" : "启用",
  "修改 Base URL",
  connected ? "替换 API Key" : "连接 API Key",
  ...(connected ? ["断开凭据"] : []),
  // "重新应用" is only present when the endpoint is enabled, valid, credentialed AND
  // not currently applied — see `canRetry`. Tests must opt in when they care.
  ...(canRetry ? ["重新应用"] : []),
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
// The actual menu may include "重新应用" (only when canRetry); position is computed from
// the currently-rendered screen, not from the caller's static array, so a present/absent
// Retry entry never desynchronises navigation.
async function choose(tui, labelsInOrder, target, { anchor, since } = {}) {
  if (!labelsInOrder.includes(target)) throw new Error(`option ${target} not in ${JSON.stringify(labelsInOrder)}`)
  // Never send keys before the dialog is on screen: stray keys would land in the session prompt.
  await waitForTui(tui, anchor ?? target, { from: since ?? 0 })
  await sleep(400)
  // Capture the CURRENT screen as the slice since we anchored: the cumulative buffer
  // keeps stale renders of the detail view alive, which would fool the presence check.
  const screenSince = tui.output(since ?? 0)
  // The canonical DETAIL menu inserts "重新应用" before "删除 endpoint" only when canRetry.
  // Detect that case from the rendered screen and treat it as if it were present in
  // `labelsInOrder` for index arithmetic.
  const effective = screenSince.includes("重新应用") && labelsInOrder.includes("删除 endpoint") && !labelsInOrder.includes("重新应用")
    ? [...labelsInOrder.slice(0, -2), "重新应用", ...labelsInOrder.slice(-2)]
    : labelsInOrder
  const index = effective.indexOf(target)
  if (index < 0) throw new Error(`option ${target} not in effective menu ${JSON.stringify(effective)}`)
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

let catalogServer
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
  catalogServer = await startCatalogServer()
  const catalogRequests = catalogServer.requests
  // [REAL-HOST-E2E] Schema-9 LKG positive recovery needs a genuine models.dev
  // outage that Core can SEE. The delivered dist keeps a 6h in-memory catalog
  // cache (production trigger: TTL expiry) and OpenCode 2.0.16 is a compiled
  // binary without any preload seam, so a tiny companion plugin — loaded by the
  // SAME real host into the SAME server process — clears that cache through the
  // INSTALLED package's own `dist/net/fetch.js` export
  // (`resetModelsDevCacheForTest`): the in-process equivalent of the production
  // TTL expiry. It never mocks a Core value and never serves fake data; the
  // outage itself is a real HTTP 500 from the deterministic catalog source.
  const catalogGuardDir = path.join(workspace, "e2e-catalog-guard")
  mkdirSync(catalogGuardDir, { recursive: true })
  writeFileSync(path.join(catalogGuardDir, "package.json"), `${JSON.stringify({ name: "e2e-catalog-guard", type: "module", main: "index.js" })}\n`)
  writeFileSync(path.join(catalogGuardDir, "index.js"), `
import { readdirSync, statSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
const discover = () => {
  const found = []
  const visit = (dir, depth = 0) => {
    if (depth > 9 || found.length > 0) return
    let names = []
    try { names = readdirSync(dir) } catch { return }
    if (names.includes("core-provenance.json") && names.includes("runtime-identity.json")) {
      found.push(path.join(dir, "net", "fetch.js"))
      return
    }
    for (const name of names) {
      let isDir = false
      try { isDir = statSync(path.join(dir, name)).isDirectory() } catch { continue }
      // OpenCode's package store nests installs under node_modules; the marker
      // pair lives in the installed package's dist.
      if (isDir) visit(path.join(dir, name), depth + 1)
    }
  }
  for (const dir of [process.env.HOME, process.env.XDG_CONFIG_HOME, process.env.XDG_DATA_HOME, process.env.XDG_STATE_HOME, process.env.XDG_CACHE_HOME]) {
    if (dir) visit(dir)
  }
  return found[0]
}
const rpcDef = {
  id: "e2e-catalog-cache",
  methods: {
    reset: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" }, module: { type: "string" }, error: { type: "string" } },
        required: ["ok"],
        additionalProperties: false,
      },
    },
  },
  events: {},
}
export default {
  id: "e2e-catalog-guard",
  async setup(ctx) {
    await ctx.rpc.register(rpcDef, {
      async reset() {
        try {
          const target = String(ctx.options.fetchModule ?? "") || discover()
          const mod = await import(pathToFileURL(target).href)
          if (typeof mod.resetModelsDevCacheForTest !== "function")
            return { ok: false, module: target, error: "resetModelsDevCacheForTest missing" }
          mod.resetModelsDevCacheForTest()
          return { ok: true, module: target }
        } catch (error) {
          return { ok: false, module: "", error: String(error) }
        }
      },
    })
  },
}
`)

  const e2eConfig = {
    $schema: "https://opencode.ai/config.json",
    // The fake service emits a plain reply, not OpenCode's required compaction
    // template. Keep the request matrix on the real SDK conversational path.
    compaction: { auto: false },
    plugins: [{
      package: packageSpec,
      options: {
        pollInterval: 30,
        modelsDevUrl: catalogServer.url,
        endpoints: {
          default: { baseUrl: defaultMock.baseUrl },
          company: { baseUrl: companyMock.baseUrl },
        },
      },
    }, {
      package: catalogGuardDir,
      options: {},
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
  const api = (...args) => command(["api", "--server", openCodeServer.url, ...args], { retries: 6 })
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
  assert(
    !commandNames.some((name) => String(name).includes("degraded")),
    `no degraded-acceptance command may exist: ${JSON.stringify(commandNames)}`,
  )
  assert(
    !commandNames.includes("litellm-acknowledge"),
    `acknowledgement must not be exposed as a slash command: ${JSON.stringify(commandNames)}`,
  )

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
  const auditTuiText = tui.output()
  await stopAttachedTui(tui)

  // [REAL-HOST-E2E] The exported audit report carries the full Runtime Identity of the candidate.
  {
    const auditDir = path.join(state, "opencode", "litellm-audit")
    assert(existsSync(auditDir), `audit directory must exist: ${auditDir}`)
    const auditFiles = readdirSync(auditDir).filter((name) => name.startsWith("litellm-audit-") && name.endsWith(".json"))
    assert(auditFiles.length > 0, "real host audit export must write a report file")
    const latestAudit = auditFiles.sort().at(-1)
    const report = JSON.parse(readFileSync(path.join(auditDir, latestAudit), "utf8"))
    assert.deepEqual(report.runtimeIdentity, candidateIdentity, "audit runtimeIdentity must equal the candidate artifact identity")
    void auditTuiText
  }

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
  assert.doesNotMatch(models.stdout, /litellm\/invalid-fields/u,
    "incomplete fixture models must never disguise as normal host models")

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
  await waitForTui(tui, /invalid-fields/u, { from: mark })
  const scopedDiagnostics = tui.output(mark)
  assert.doesNotMatch(scopedDiagnostics, /LiteLLM Endpoints · active \d+\/\d+/u,
    "endpoint-scoped diagnostics must not fall back to the multi-endpoint overview")
  // [REAL-HOST-E2E] Endpoint-scoped diagnostics carry the candidate Runtime Identity (short form).
  assert.match(scopedDiagnostics, /Runtime Identity/u, "diagnostics must show the Runtime Identity section")
  assert(scopedDiagnostics.includes(`Plugin Version   ${expectedPluginVersion}`), "diagnostics plugin version must match the candidate")
  assert(scopedDiagnostics.includes(`Artifact         ${expectedShortDigest}`), "diagnostics artifact digest must match the candidate")
  assert(scopedDiagnostics.includes(`Core Commit      ${expectedShortCore}`), "diagnostics core commit must match the candidate provenance")
  assert.doesNotMatch(scopedDiagnostics, /sk-e2e-/u, "diagnostics must not leak credentials")
  await stopAttachedTui(tui)

  // [REAL-HOST-E2E] The server startup log records the same Runtime Identity.
  {
    const serverText = `${openCodeServer.output().stdout}\n${openCodeServer.output().stderr}`
    assert.match(serverText, /LiteLLM Runtime Identity/u, "startup log must contain the Runtime Identity line")
    assert(serverText.includes(`plugin=${expectedPluginVersion}`), "startup plugin version must match the candidate")
    assert(serverText.includes(`artifact=${expectedShortDigest}`), "startup artifact digest must match the candidate")
    assert(serverText.includes(`core=${expectedShortCore}`), "startup core commit must match the candidate")
  }

  const pluginState = jsonOutput(api("GET", "/api/plugin"), "plugin.list")
  const plugins = payload(pluginState)
  assert(Array.isArray(plugins), "plugin.list payload must be an array")
  assert(plugins.some((item) => item.id === "litellm" && item.state?.status === "active"),
    `server plugin must be active: ${JSON.stringify(plugins.filter((item) => item.id === "litellm"))}`)

  // ===== Publication phase: trusted verdicts through the real host =====
  const auditDirPath = path.join(state, "opencode", "litellm-audit")
  const auditNames = () =>
    existsSync(auditDirPath)
      ? readdirSync(auditDirPath).filter((name) => name.startsWith("litellm-audit-") && name.endsWith(".json"))
      : []
  const defaultAuditReport = (audit) => audit.endpoints?.find((entry) => entry.id === "default")?.report ?? audit

  // Export a fresh audit report; the command writes a file, so no TUI is needed.
  const exportAudit = async () => {
    const startedAt = Date.now()
    const before = new Set(auditNames())
    runSessionCommand("litellm-audit-export")
    for (let attempt = 0; attempt < 80; attempt++) {
      await sleep(250)
      const names = auditNames()
      const fresh = names.filter((name) => !before.has(name))
      const candidates = fresh.length > 0 ? fresh : names.filter(
        (name) => statSync(path.join(auditDirPath, name)).mtimeMs >= startedAt,
      )
      if (candidates.length > 0) {
        const latest = candidates.slice().sort().at(-1)
        return JSON.parse(readFileSync(path.join(auditDirPath, latest), "utf8"))
      }
    }
    throw new Error("audit export did not produce a fresh report")
  }

  const waitForRefreshAfter = async (sinceMs, label) => {
    for (let attempt = 0; attempt < 90; attempt++) {
      const report = defaultAuditReport(await exportAudit())
      const stamp = Date.parse(report.lastSuccessfulDiscoveryAt ?? "")
      if (Number.isFinite(stamp) && stamp > sinceMs) return report
      await sleep(1000)
    }
    throw new Error(`no discovery refresh after ${label}`)
  }

  const waitForAuditStatus = async (expected, label) => {
    for (let attempt = 0; attempt < 90; attempt++) {
      const report = defaultAuditReport(await exportAudit())
      if (report.status === expected) return report
      await sleep(1000)
    }
    throw new Error(`default endpoint never reached audit status ${expected} (${label})`)
  }

  // PTY text normalization may collapse the full-width colon, so publication
  // needles are matched as regexes on semantic spacing.
  const diagnosticsThroughTui = async (needle, label) => {
    const matches = (text) => (typeof needle === "string" ? text.includes(needle) : needle.test(text))
    let last = ""
    for (let attempt = 0; attempt < 6; attempt++) {
      runSessionCommand("litellm-diagnostics", "default")
      const diagTui = startAttachedTui(sessionID)
      try {
        await waitForTui(diagTui, /Endpoint[\s：:]+default/u, { timeout: 20_000 })
        last = diagTui.output()
        if (matches(last)) return last
      } catch (error) {
        last = String(error)
      } finally {
        await stopAttachedTui(diagTui)
      }
      await sleep(1000)
    }
    throw new Error(`diagnostics never reported ${label}; last:\n${last}`)
  }

  const hostModels = () => command(["models", "--server", openCodeServer.url], { timeout: 120_000 }).stdout

  // [REAL-HOST-E2E] Core's publication partition through the real host's
  // read-only plugin RPC (`litellm-publication.state`): the only host surface
  // that reports the literal publication status (`configured` /
  // `configured-lkg`) and the usingLKG projection (`lkgIDs`).
  const publicationState = () => {
    const result = jsonOutput(
      command(["api", "--server", openCodeServer.url, "POST", "/api/rpc/litellm-publication/state", "--data", JSON.stringify({ input: {} })], { retries: 6, echo: false }),
      "litellm-publication.state",
    )
    return result.output
  }

  const waitForPublicationState = async (predicate, label) => {
    let last
    for (let attempt = 0; attempt < 90; attempt += 1) {
      try {
        last = publicationState()
        if (predicate(last)) return last
      } catch (error) {
        last = String(error)
      }
      await sleep(1000)
    }
    throw new Error(`publication state never matched ${label}; last=${JSON.stringify(last)}`)
  }

  // [REAL-HOST-E2E] Card lines wrap at the terminal width and sit inside
  // box-drawing borders; normalize both away so assertions on long facts can
  // never straddle a wrap boundary.
  const cardText = (text) => text.replace(/[┃╹▀╻╺╸]/gu, "").replace(/\s+/gu, "")

  // Clear the delivered dist's 6h models.dev catalog cache through the guard
  // plugin's RPC. The response names the module that was reset: it must be the
  // INSTALLED candidate's `dist/net/fetch.js`, so the reset lands on the same
  // module instance the plugin's discovery loop uses.
  const resetCatalogCache = async () => {
    const result = jsonOutput(
      command(["api", "--server", openCodeServer.url, "POST", "/api/rpc/e2e-catalog-cache/reset", "--data", JSON.stringify({ input: {} })], { retries: 6, echo: false }),
      "e2e-catalog-cache.reset",
    )
    const output = result.output ?? {}
    assert.equal(output.ok, true, `the catalog cache reset must reach the installed fetch module: ${JSON.stringify(output)}`)
    assert.match(String(output.module), /net[\\/]fetch\.js$/u, `the reset must target dist/net/fetch.js: ${JSON.stringify(output)}`)
    assert.match(String(output.module), /opencode-litellm-provider/u, `the reset must target the installed candidate package: ${JSON.stringify(output)}`)
    return output
  }

  // Frozen final registry/picker configuration, real model selection and SDK requests.
  const controls = [
    { model_name:"e2e-no-effort", model_info:{mode:"chat"} },
    { model_name:"e2e-disabled", model_info:{mode:"chat"} },
    { model_name:"e2e-messages", litellm_params:{model:"anthropic/e2e-messages"}, model_info:{mode:"chat"} },
  ]
  servedModels = [...frozenDiscovery.data, ...controls]
  currentCatalog = structuredClone(baselineCatalog)
  await resetCatalogCache()
  const matrixReport = await waitForRefreshAfter(Date.now(),"the frozen 16-model matrix")
  const matrixIDs = matrixReport.models.map(model=>model.id)
  assert.equal(matrixIDs.length,19,"all frozen models and the three controls register")
  const actualModels = payload(jsonOutput(api("GET","/api/model"),"model.list"))
  assert(Array.isArray(actualModels),"real host registry returns Model.Info[] for the picker")
  for(const expected of oracle.models) {
    const actual=actualModels.find(model=>model.providerID==="litellm" && model.id===expected.id)
    assert(actual,`frozen model is missing from host registry: ${expected.id}`)
    assert.equal(actual.modelID,expected.id)
    assert.equal(actual.name,expected.id)
    assert.deepEqual(actual.limit,{input:0,...expected.limit})
    assert.deepEqual(actual.capabilities,{tools:expected.tools,input:expected.input,output:expected.output})
    assert.deepEqual(actual.variants.map(variant=>variant.id),expected.levels,`${expected.id}: no default variants`)
    const audit=matrixReport.models.find(model=>model.id===expected.id)
    assert.equal(audit.reasoningSupported,expected.reasoningSupported)
    assert.equal(audit.metadata.canonicalID,expected.canonicalID)
    assert.equal(audit.metadata.provider,expected.provider)
    assert.equal(audit.metadata.recordKey,expected.recordKey)
    assert.equal(audit.protocol,expected.protocol)
    assert.deepEqual(actual.cost[0],{input:expected.cost.input??0,output:expected.cost.output??0,cache:{read:expected.cost.cache_read??0,write:expected.cost.cache_write??0}})
  }
  assert.deepEqual(actualModels.find(model=>model.providerID==="litellm"&&model.id==="e2e-no-effort").variants,[])
  assert.deepEqual(actualModels.find(model=>model.providerID==="litellm"&&model.id==="e2e-disabled").variants,[])
  // OpenCode 2.0.16 Model.Info has tools/modalities and variants, but no reasoning
  // boolean. The adapter preserves the independent Core verdict in its audit view.
  assert.equal(matrixReport.models.find(model=>model.id==="e2e-no-effort").reasoningSupported,"supported")
  assert.equal(matrixReport.models.find(model=>model.id==="e2e-disabled").reasoningSupported,"unsupported")
  const requestSession=payload(jsonOutput(api("POST","/api/session","--data",JSON.stringify({title:"metadata request matrix"})),"session.create")).id
  let checkedRequests=0
  const requestModel = async (id,variant,protocol) => {
    const ref={id,providerID:"litellm",...(variant===undefined?{}:{variant})}
    api("POST",`/api/session/${requestSession}/model`,"--data",JSON.stringify({model:ref}))
    const selected=payload(jsonOutput(api("GET",`/api/session/${requestSession}`),"session.get"))
    assert.deepEqual(selected.model,ref,"real session stores the selected model and declared variant")
    const before=defaultMock.requests.length
    const started=Date.now()
    api("POST",`/api/session/${requestSession}/prompt`,"--data",JSON.stringify({text:"Reply ok. Do not call any tools."}))
    let finished
    for(let attempt=0;attempt<100;attempt++) {
      await sleep(200)
      const state=payload(jsonOutput(api("GET",`/api/session/${requestSession}`),"session.get"))
      if(Date.parse(state.time?.idle??"")>=started || (typeof state.time?.idle==="number"&&state.time.idle>=started)){finished=state;break}
    }
    assert(finished,`${id}/${variant??"default"}: actual host turn did not finish`)
    if(finished.outcome!=="succeeded") api("GET",`/api/session/${requestSession}/context`)
    assert.equal(finished.outcome,"succeeded",`${id}/${variant??"default"}: SDK turn failed; session=${sanitize(JSON.stringify(finished))}; requests=${JSON.stringify(defaultMock.requests.slice(before).map(request=>({path:request.path,model:request.body.model,reasoning_effort:request.body.reasoning_effort,reasoning:request.body.reasoning,thinking:request.body.thinking})))}`)
    const requests=defaultMock.requests.slice(before).filter(request=>request.body.model===id)
    assert(requests.length>0,`${id}/${variant??"default"}: SDK never reached LiteLLM`)
    for(const request of requests){
      assert.equal(request.path,protocol==="responses"?"/v1/responses":protocol==="messages"?"/v1/messages":"/v1/chat/completions")
      // OpenCode's native Responses SDK preserves initial effort for prompt
      // caching and lowers later session changes as configuration_update items
      // (effort-updates.js and openai-responses.js). Check the effective wire value.
      const updates=protocol==="responses" ? request.body.input.filter(item=>item.type==="configuration_update") : []
      const effort=protocol==="responses" && updates.length ? updates.at(-1).reasoning.effort : request.body.reasoning_effort??request.body.reasoning?.effort
      if(protocol==="messages") { assert.equal(request.body.thinking?.type,"enabled");assert.equal(request.body.thinking?.budget_tokens,variant==="max"?64000:16000) }
      else assert.equal(effort,variant,`${id}: exact requested reasoning effort`)
      if(variant===undefined){assert.equal(request.body.thinking,undefined);assert.equal(request.body.reasoning,undefined);assert.equal(request.body.reasoning_effort,undefined)}
      checkedRequests++
    }
  }
  for(const expected of oracle.models)for(const level of expected.levels)await requestModel(expected.id,level,expected.protocol)
  await requestModel("e2e-no-effort",undefined,"chat")
  await requestModel("e2e-disabled",undefined,"chat")
  for(const level of ["high","max"])await requestModel("e2e-messages",level,"messages")
  console.log(`Real OpenCode metadata priority: 16/16 final registrations and picker lists; ${checkedRequests} actual Chat/Responses/Messages requests passed`)

  // Prices do not withdraw or cap models, even with otherwise higher-priority data.
  for(const provider of Object.values(currentCatalog.providers))for(const record of Object.values(provider.models))record.cost={input:-1,output:"bad"}
  await resetCatalogCache()
  const zeroPrice=await waitForRefreshAfter(Date.now(),"the price-only error")
  assert.equal(zeroPrice.models.length,19)
  for(const model of zeroPrice.models)assert.deepEqual(model.cost[0],{input:0,output:0,cache:{read:0,write:0}})
  assert.deepEqual(publicationState().regressions,[])
  for(const expected of oracle.models)assert.deepEqual(zeroPrice.models.find(model=>model.id===expected.id).limit,{input:0,...expected.limit})

  // Catalog outage + internal route/deployment changes preserve model_name LKG.
  servedModels=[...frozenDiscovery.data.map(row=>({...row,litellm_params:{model:"private/changed"}})),...controls]
  const failuresBefore=catalogServer.failures()
  catalogServer.setOutage(true);await resetCatalogCache()
  const lkg=await waitForPublicationState(state=>state.lkgIDs.length===19,"the genuine catalog outage")
  assert(catalogServer.failures()>failuresBefore,"the live catalog really failed after cache invalidation")
  assert.equal(lkg.publishable.length,19)
  const lkgReport=await waitForRefreshAfter(Date.now(),"the catalog outage configuration")
  assert.deepEqual(lkgReport.models.map(model=>({id:model.id,limit:model.limit,variants:model.variants})),zeroPrice.models.map(model=>({id:model.id,limit:model.limit,variants:model.variants})))
  await diagnosticsThroughTui(/LKG 19/u,"LKG metadata summary")
  catalogServer.setOutage(false);currentCatalog=structuredClone(baselineCatalog);await resetCatalogCache()
  await waitForPublicationState(state=>state.publishable.length===19&&state.lkgIDs.length===0,"fresh recovery")

  // A successful live deletion wins over cached models.
  servedModels=[]
  const empty=await waitForRefreshAfter(Date.now(),"successful empty LiteLLM catalog")
  assert.deepEqual(empty.models,[])
  assert(!hostModels().includes("litellm/"),"deleted models must leave host registry")

  // Missing/illegal critical metadata stays withheld; repairing its API record
  // publishes automatically, without new acceptance or provider configuration.
  servedModels=servedFixture.data
  await resetCatalogCache()
  const partial=await waitForRefreshAfter(Date.now(),"the partial lifecycle catalog")
  assert(partial.models.length>0)
  assert(!partial.models.some(model=>model.id==="invalid-fields"))
  assert(!partial.models.some(model=>model.id==="minimax-m3"))
  await diagnosticsThroughTui(/withheld[\s：:]*invalid-fields/u,"critical field withholding")
  currentCatalog.providers.e2e.models["minimax-m3"].reasoning=false
  await resetCatalogCache()
  const repaired=await waitForRefreshAfter(Date.now(),"selected API record repair")
  assert(repaired.models.some(model=>model.id==="minimax-m3"),"complete metadata registers without user acceptance")

  // Existing notification memory must survive a real host restart.
  const unusableModels=()=>["gap-a","gap-b"].map(model_name=>({model_name,model_info:{mode:"chat"}}))
  servedModels=unusableModels()
  await waitForRefreshAfter(Date.now(),"the unusable catalog")
  await diagnosticsThroughTui(/catalog 当前不可用/u,"unusable catalog diagnostics")
  openCodeServer.child.kill();await sleep(1500)
  openCodeServer=await startOpenCodeServer();env.OPENCODE_PASSWORD=openCodeServer.password
  await waitForRefreshAfter(Date.now(),"post-restart discovery")
  const restarted=await diagnosticsThroughTui(/catalog 当前不可用/u,"persisted notification acknowledgement")
  assert(/提醒状态：该问题集合已确认/u.test(restarted),"same problem set stays quiet across restart")
  servedModels=[...unusableModels(),{model_name:"gap-c",model_info:{mode:"chat"}}]
  await waitForRefreshAfter(Date.now(),"the changed problem set")
  const changed=await diagnosticsThroughTui(/withheld[\s：:]*gap-c/u,"new missing model")
  assert(!/提醒状态：该问题集合已确认/u.test(changed),"material change is reported again")
  console.log("[ack persistence] surfaced -> restarted suppressed -> material change re-surfaced")

  // Network failures retain last successful models; auth errors clear them.
  servedModels=servedFixture.data
  await waitForRefreshAfter(Date.now(),"network recovery baseline")
  mockFailStatus=500
  await waitForAuditStatus("stale","the network failure")
  assert(hostModels().includes("litellm/multi-endpoint-model"),"network failure retains last good models")
  mockFailStatus=0
  await waitForAuditStatus("ready","network recovery")
  const previousKey=defaultMock.keys.expected
  defaultMock.keys.expected="sk-injected-auth-failure"
  await waitForAuditStatus("cleared-auth","authentication failure")
  assert(!hostModels().includes("litellm/"),"authentication failure removes default endpoint models")
  defaultMock.keys.expected=previousKey
  await waitForAuditStatus("ready","authentication recovery")
  currentCatalog=structuredClone(baselineCatalog)
  console.log("Real OpenCode publication E2E passed: prices, critical metadata, route-independent LKG, recovery, deletion, network/auth and notification restart persistence verified")

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
        "modelsDevUrl": ${JSON.stringify(catalogServer.url)},
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
    // Startup frame of /litellm-endpoints renders the whole main list at once;
    // company is on the same screen as the "＋ 新增 endpoint" anchor. Use the
    // full buffer (no `from`) so the assertion matches regardless of when
    // company was first painted relative to our mark.
    await waitForTui(t, "company")

    // 1. ADD (ID + Base URL only) -> inactive / not connected; nothing discovered yet
    const mainList = (items) => ["＋ 新增 endpoint", "全部启用", "全部停用", ...items]
    m = await choose(t, mainList(["✓ company"]), "＋ 新增 endpoint", { since: m })
    await waitForTui(t, /新增\s*\S*：/u, { from: m })
    await type(t, "e2e-new"); m = t.mark(); t.write("\r")
    await waitForTui(t, /Base\s*URL/u, { from: m })
    await type(t, mgmtA.baseUrl); m = t.mark(); t.write("\r")
    await waitForTui(t, /e2e-new[^|]*未启用[^|]*未保存/u, { from: m })
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
    m = await choose(t, detail, "连接 API Key", { anchor: /e2e-new[^|]*未启用[^|]*未保存/u, since: m })
    await waitForTui(t, /连接\s*\S*\s*的\s*API/u, { from: m })
    await type(t, "sk-mgmt-one")
    const beforeSubmit = t.mark()
    t.write("\r")
    await waitForTui(t, /e2e-new[^|]*未启用[^|]*已保存/u, { from: beforeSubmit })
    assert.equal(connectionsOf("litellm-e2e-new").length, 1, "Connect did not store a credential through the host")
    assert(!providerIds().includes("litellm-e2e-new"), "Connect must not activate the endpoint")
    const afterConnect = t.mark()
    await sleep(800)
    assert(!t.output(afterConnect).includes("sk-mgmt-one"), "the API key was echoed after submit")
    m = beforeSubmit

// [ACT-IMMEDIATE]
    // 3. ACTIVATE -> provider + models appear; discovery used the connected key
    detail = DETAIL(false, true)
    await choose(t, detail, "启用", { anchor: /e2e\S*[^|]*未启用[^|]*已保存/u, since: m })
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
    m = await choose(t, detail, "修改 Base URL", { anchor: /e2e\S*[^|]*已启用[^|]*已保存/u, since: m })
    await waitForTui(t, "ID 不可修改", { from: m })
    await clear(t, mgmtA.baseUrl.length + 5)
    await type(t, mgmtB.baseUrl)
    m = t.mark()
    t.write("\r")
    await waitForTui(t, /e2e-new[^|]*已启用[^|]*已保存/u, { from: m })
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
    m = await choose(t, DETAIL(true, true), "替换 API Key", { anchor: /e2e\S*[^|]*已启用[^|]*已保存/u, since: m })
    await waitForTui(t, /替换\s*\S*\s*的\s*API/u, { from: m })
    await type(t, "sk-mgmt-two")
    m = t.mark()
    t.write("\r")
    await waitForTui(t, /e2e-new[^|]*已启用[^|]*已保存/u, { from: m })
    assert.equal(connectionsOf("litellm-e2e-new").length, 1, "Replace must overwrite, leaving exactly one credential")

    // 6. DISCONNECT (confirm dialog): credential gone, endpoint + activation stay
    m = await choose(t, DETAIL(true, true), "断开凭据", { anchor: /e2e\S*[^|]*已启用[^|]*已保存/u, since: m })
    await waitForTui(t, /仅删除[^|]*已保存的\s*API/u, { from: m })
    m = t.mark()
    t.write("\r") // default focus = Confirm (probed on the real TUI)
    await waitForTui(t, /e2e-new[^|]*已启用[^|]*未保存/u, { from: m })
    assert.equal(connectionsOf("litellm-e2e-new").length, 0, "Disconnect left a credential behind")
    assert(parsedOptions().endpoints["e2e-new"], "Disconnect removed the endpoint definition")
    assert.deepEqual(connectionsOf("litellm-company").map((c) => c.id).sort(), companyBaseline, "Disconnect touched another endpoint's credential")

    // 7. CONNECT again, then DEACTIVATE
    m = await choose(t, DETAIL(true, false), "连接 API Key", { anchor: /e2e\S*[^|]*已启用[^|]*未保存/u, since: m })
    await waitForTui(t, /连接\s*\S*\s*的\s*API/u, { from: m })
    await type(t, "sk-mgmt-two")
    m = t.mark()
    t.write("\r")
    await waitForTui(t, /e2e-new[^|]*已启用[^|]*已保存/u, { from: m })
    await choose(t, DETAIL(true, true), "停用", { anchor: /e2e\S*[^|]*已启用[^|]*已保存/u, since: m })
    await waitForTui(t, /e2e-new[^|]*未启用[^|]*已保存/u, { from: m })
    await waitProviders([], ["litellm-e2e-new"])
    assert.equal(connectionsOf("litellm-e2e-new").length, 1, "Deactivate removed the credential")

    // 8. DELETE (confirm): definition, credential and provider all go; company keeps everything
    m = await choose(t, DETAIL(false, true), "删除 endpoint", { anchor: /e2e\S*[^|]*未启用[^|]*已保存/u, since: m })
    await waitForTui(t, /将彻底删/u, { from: m })
    m = t.mark()
    t.write("\r")
    // Completion is asserted on the observable end state (the management list comes back without the
    // endpoint): the success toast's text can be left partially repainted by terminal cell diffs.
    await waitForTui(t, "选择 endpoint 或操作", { from: m })
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
        "modelsDevUrl": ${JSON.stringify(catalogServer.url)},
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
    await waitForTui(tl, /default[^|]*已保存/u, { from: ml })
    assert(legacyOptions().endpoints === undefined, "test setup must start in legacy mode")

    // phase 2 left an explicit activation selection; enable everything first (the legacy default row is
    // inactive until then, and an inactive endpoint still keeps its /connect integration).
    ml = await choose(tl, ["＋ 新增 endpoint", "全部启用", "全部停用", "○ default"], "全部启用", { since: ml })
    await waitForTui(tl, /default[^|]*已启用[^|]*已保存/u, { from: ml })

    // 3b. Legacy Delete Cancel (before any migration): cancelling the final confirmation is side-effect free
    const legacyDetail = ["停用", "修改 Base URL", "替换 API Key", "断开凭据", "删除 endpoint", "返回"]
    ml = await choose(tl, ["＋ 新增 endpoint", "全部启用", "全部停用", "✓ default"], "✓ default", { since: ml })
    ml = await choose(tl, legacyDetail, "删除 endpoint", { anchor: /default[^|]*已启用[^|]*已保存/u, since: ml })
    await waitForTui(tl, /legacy 单 endpoint/u, { from: ml }) // the combined confirmation explains the internal migration
    const cancelFrom = tl.mark()
    const beforeCancelConnections = connectionsOf("litellm").map((c) => c.id)
    tl.write("\x1b") // Escape closes the confirmation unanswered = Cancel
    await sleep(800)
    assert.equal(legacyOptions().endpoints, undefined, "a cancelled Delete must not migrate the legacy configuration")
    assert(readLegacy().includes("// phase 3: legacy single-endpoint configuration"), "a cancelled Delete modified the config")
    assert.deepEqual(connectionsOf("litellm").map((c) => c.id), beforeCancelConnections, "a cancelled Delete must not remove the credential")
    assert(integrationsNow().some((i) => i.id === "litellm"), "a cancelled Delete must keep the integration")
    await waitForTui(tl, /default[^|]*已启用[^|]*已保存/u, { from: cancelFrom }) // back on the detail screen: still usable
    ml = await choose(tl, legacyDetail, "返回", { anchor: /default[^|]*已启用[^|]*已保存/u, since: cancelFrom })

    // 4. credential management through the UI: Replace first migrates (confirm), then saves the new key
    ml = await choose(tl, ["＋ 新增 endpoint", "全部启用", "全部停用", "✓ default"], "✓ default", { since: ml })
    ml = await choose(tl, legacyDetail, "替换 API Key", { anchor: /default[^|]*已启用[^|]*已保存/u, since: ml })
    await waitForTui(tl, /迁移为可管理配置/u, { from: ml })
    ml = tl.mark()
    tl.write("\r") // Confirm on the migration dialog (default focus, probed on the real TUI)
    await waitForTui(tl, /替换\s*\S*\s*的\s*API/u, { from: ml })
    await type(tl, "sk-legacy-replaced")
    ml = tl.mark()
    tl.write("\r")
    await waitForTui(tl, /default[^|]*已启用[^|]*已保存/u, { from: ml })
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
    ml = await choose(tl, legacyDetail, "修改 Base URL", { anchor: /default[^|]*已启用[^|]*已保存/u, since: ml })
    await waitForTui(tl, /ID\s*不可修改/u, { from: ml })
    await clear(tl, legacyMock.baseUrl.length + 5)
    await type(tl, legacyTarget.baseUrl)
    ml = tl.mark()
    tl.write("\r")
    await waitForTui(tl, /default[^|]*已启用[^|]*已保存/u, { from: ml })
    assert.equal(legacyOptions().endpoints.default.baseUrl, legacyTarget.baseUrl, "Edit must update the migrated Base URL")
    assert.deepEqual(legacyOptions().endpoints.default.protocolOverrides, { "demo-model": "chat" }, "Edit dropped protocolOverrides")
    assert(readLegacy().includes("// phase 3: legacy single-endpoint configuration"), "Edit removed user comments")
    for (let i = 0; i < 40 && legacyTarget.acceptedRequests() <= targetBefore; i++) await sleep(500)
    assert(legacyTarget.acceptedRequests() > targetBefore, "the edited Base URL was never used for discovery")
    assert.equal(legacyMock.acceptedRequests(), oldUrlBefore, "the migrated endpoint must not query the old address after the edit")

    // 7. Delete through the UI (definition + credential go)
    ml = await choose(tl, legacyDetail, "删除 endpoint", { anchor: /default[^|]*已启用[^|]*已保存/u, since: ml })
    await waitForTui(tl, /将彻底删/u, { from: ml })
    ml = tl.mark()
    tl.write("\r") // Confirm (default focus)
    // Same as the explicit flow: assert completion via the list coming back without the endpoint —
    // the success toast's text can be left partially repainted by terminal cell diffs.
    await waitForTui(tl, "选择 endpoint 或操作", { from: ml })
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

  // ===== Phase 4: ghostless legacy (no connected address) → first Add must not pin a stale default =====
  openCodeServer.child.kill()
  await sleep(1500)
  const ghostUrl = "http://127.0.0.1:9"
  writeFileSync(opencodeConfigFile, `{
  // phase 4: ghostless legacy single-endpoint configuration
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "${packageSpec}",
      "options": {
        "pollInterval": 30,
        "modelsDevUrl": ${JSON.stringify(catalogServer.url)}
      }
    }
  ]
}
`)
  openCodeServer = await startOpenCodeServer()
  env.OPENCODE_PASSWORD = openCodeServer.password
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = payload(jsonOutput(api("GET", "/api/plugin"), "plugin.list"))
    const item = Array.isArray(state) ? state.find((entry) => entry.id === "litellm") : undefined
    if (item?.state?.status === "active") break
    await sleep(500)
  }

  const ghostSession = payload(jsonOutput(api("POST", "/api/session", "--data", JSON.stringify({ title: "LiteLLM ghostless mgmt" })), "session.create")).id
  api("POST", `/api/session/${ghostSession}/command`, "--data", JSON.stringify({ name: "litellm-endpoints", text: "" }))
  const tg = startAttachedTui(ghostSession)
  let mg = tg.mark()
  await waitForTui(tg, "＋ 新增 endpoint", { from: mg })
  assert(!tg.output(mg).includes("default"), "ghostless legacy must not list a default row")
  assert(!tg.output(mg).includes("全部启用"), "a ghostless legacy list must offer only Add")

  // 1. first Add: no migration dialog exists (nothing to migrate); the endpoint starts inactive
  const typeInto = async (tui, value) => { for (const ch of value) { tui.write(ch); await sleep(15) } await sleep(200) }
  mg = await choose(tg, ["＋ 新增 endpoint"], "＋ 新增 endpoint", { since: mg })
  await waitForTui(tg, /新增\s*\S*：/u, { from: mg })
  await typeInto(tg, "company")
  mg = tg.mark()
  tg.write("\r")
  await waitForTui(tg, /Base\s*URL/u, { from: mg })
  await typeInto(tg, ghostUrl)
  mg = tg.mark()
  tg.write("\r")
  await waitForTui(tg, /company[^|]*未启用/u, { from: mg }) // inactive; credential state is inherited from the shared data dir
  assert(!tg.output(mg).includes("default"), "the internal legacy default identity must not surface")
  const ghostOptions = () => JSON.parse(readFileSync(opencodeConfigFile, "utf8").replace(/^\s*\/\/.*$/gmu, "")).plugins[0].options
  assert.deepEqual(Object.keys(ghostOptions().endpoints), ["company"], "ghostless Add must write only the new endpoint")

  // 2. hand-add endpoints.default: a stale default activation must not auto-activate it
  writeFileSync(opencodeConfigFile, `{
  // phase 4: ghostless legacy single-endpoint configuration
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "${packageSpec}",
      "options": {
        "pollInterval": 30,
        "endpoints": {
          "default": { "baseUrl": "${ghostUrl}" },
          "company": { "baseUrl": "${ghostUrl}" }
        }
      }
    }
  ]
}
`)
  tg.write("\x1b")
  await sleep(300)
  await stopAttachedTui(tg)

  const ghostSession2 = payload(jsonOutput(api("POST", "/api/session", "--data", JSON.stringify({ title: "LiteLLM ghostless hand edit" })), "session.create")).id
  api("POST", `/api/session/${ghostSession2}/command`, "--data", JSON.stringify({ name: "litellm-endpoints", text: "" }))
  const tg2 = startAttachedTui(ghostSession2)
  const mg2 = tg2.mark()
  await waitForTui(tg2, "＋ 新增 endpoint", { from: mg2 })
  await waitForTui(tg2, /default[^|]*未启用/u, { from: mg2 })
  await waitForTui(tg2, /company[^|]*未启用/u, { from: mg2 })
  assert(!tg2.output(mg2).includes("✓ default"), "a hand-added default must not be auto-activated by a stale default activation")
  assert(!tg2.output(mg2).includes("✓ company"), "a hand edit must not auto-activate the company endpoint")
  tg2.write("\x1b")
  await sleep(300)
  await stopAttachedTui(tg2)
  console.log("Real OpenCode 2.0.16 ghostless legacy E2E passed: Add starts inactive and no stale default activation")

  console.log("Real OpenCode 2.0.16 E2E passed: startup recovery, native keyboard activation, endpoint-scoped diagnostics, credentials, providers, models and schema-9 LKG recovery (configured -> configured-lkg -> configured) are verified.")
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
    // The deterministic catalog listener shares this lifecycle; leaving it open
    // kept the E2E process alive after the final assertion.
    catalogServer.close(),
  ])
  // A just-killed OpenCode may still be writing its cache: never let cleanup mask the real result.
  await sleep(1000)
  try { rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }) } catch (error) {
    process.stderr.write(`cleanup skipped: ${error.code ?? error.message}\n`)
  }
}
