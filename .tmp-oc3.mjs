import fs from "node:fs"

const p = "scripts/e2e-opencode-v2.mjs"
let s = fs.readFileSync(p, "utf8")

const oldCommand = `function command(args, options = {}) {
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
    process.stdout.write(\`$ opencode \${args.join(" ")}\\\\n\`)
    if (stdout) process.stdout.write(stdout)
    if (stderr) process.stderr.write(stderr)
  }
  if (!options.allowFailure && (result.error || result.status !== 0)) {
    throw new Error(\`opencode exited \${result.status ?? "unknown"}: \${result.error?.message ?? (stderr || stdout)}\`)
  }
  return { status: result.status, stdout, stderr }
}`
if (!s.includes(oldCommand)) throw new Error("command() missing")

const newCommand = `/** Synchronous sleep so the retry loop stays inside spawnSync-based helpers. */
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
      maxBuffer: 32 * 1024 * 1024,
    })
    const stdout = sanitize(result.stdout ?? "")
    const stderr = sanitize(result.stderr ?? "")
    const retryable = attempt < attempts && (result.error || result.status !== 0) &&
      /Could not reach server|timed out|Transport:/u.test(\`\${stdout}\${stderr}\`)
    if (retryable) {
      // The real host's own CLI client uses a short HTTP timeout, and the server
      // is still starting its filesystem watchers: a transient transport failure
      // here is not a plugin failure.
      if (options.echo !== false) process.stdout.write(\`$ opencode \${args.join(" ")} (retry \${attempt}/\${attempts})\\\\n\`)
      sleepSync(2_000)
      continue
    }
    if (options.echo !== false) {
      process.stdout.write(\`$ opencode \${args.join(" ")}\\\\n\`)
      if (stdout) process.stdout.write(stdout)
      if (stderr) process.stderr.write(stderr)
    }
    if (!options.allowFailure && (result.error || result.status !== 0)) {
      throw new Error(\`opencode exited \${result.status ?? "unknown"}: \${result.error?.message ?? (stderr || stdout)}\`)
    }
    return { status: result.status, stdout, stderr }
  }
}`
s = s.replace(oldCommand, newCommand)

const oldApi = `  const api = (...args) => command(["api", "--server", openCodeServer.url, ...args])`
if (!s.includes(oldApi)) throw new Error("api helper missing")
s = s.replace(oldApi, `  const api = (...args) => command(["api", "--server", openCodeServer.url, ...args], { retries: 6 })`)

fs.writeFileSync(p, s)
console.log("api retry added")
