import { readFileSync } from "node:fs"

export interface RuntimeIdentity {
  pluginVersion: string
  artifactDigest: string
  coreCommit: string
}

export class RuntimeIdentityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RuntimeIdentityError"
  }
}

const UNKNOWN = "unknown"

export function isValidPluginVersion(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64 && /^[0-9A-Za-z.+_-]+$/u.test(value)
}

export function isValidArtifactDigest(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value)
}

export function isValidCoreCommit(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/u.test(value)
}

export function parseRuntimeIdentity(value: unknown): RuntimeIdentity {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RuntimeIdentityError("Runtime identity must be a JSON object")
  }
  const record = value as Record<string, unknown>
  if (!isValidPluginVersion(record.pluginVersion)) {
    throw new RuntimeIdentityError("Runtime identity pluginVersion is missing or invalid")
  }
  if (!isValidArtifactDigest(record.artifactDigest)) {
    throw new RuntimeIdentityError("Runtime identity artifactDigest is missing or invalid")
  }
  if (!isValidCoreCommit(record.coreCommit)) {
    throw new RuntimeIdentityError("Runtime identity coreCommit is missing or invalid")
  }
  return {
    pluginVersion: record.pluginVersion,
    artifactDigest: record.artifactDigest,
    coreCommit: record.coreCommit,
  }
}

function readJSONFile(url: URL): unknown {
  return JSON.parse(readFileSync(url, "utf8"))
}

function loadFromCandidates(): RuntimeIdentity {
  const candidates = [
    new URL("../runtime-identity.json", import.meta.url),
    new URL("../../dist/runtime-identity.json", import.meta.url),
  ]
  let found = false
  for (const candidate of candidates) {
    let value: unknown
    try {
      value = readJSONFile(candidate)
    } catch {
      continue
    }
    found = true
    return parseRuntimeIdentity(value)
  }
  throw new RuntimeIdentityError(
    found ? "Runtime identity is invalid" : "Runtime identity file is missing",
  )
}

const UNKNOWN_IDENTITY: RuntimeIdentity = {
  pluginVersion: UNKNOWN,
  artifactDigest: UNKNOWN,
  coreCommit: UNKNOWN,
}

let cached: RuntimeIdentity | undefined

export function getRuntimeIdentity(): RuntimeIdentity {
  if (!cached) {
    try {
      cached = loadFromCandidates()
    } catch {
      cached = { ...UNKNOWN_IDENTITY }
    }
  }
  return cached
}

export function loadRuntimeIdentityStrict(): RuntimeIdentity {
  return loadFromCandidates()
}

export function resetRuntimeIdentityForTests(): void {
  cached = undefined
}

export function setRuntimeIdentityForTests(identity: RuntimeIdentity): void {
  cached = { ...parseRuntimeIdentity(identity) }
}

export function shortArtifactDigest(identity: RuntimeIdentity): string {
  if (!isValidArtifactDigest(identity.artifactDigest)) return UNKNOWN
  return identity.artifactDigest.slice("sha256:".length, "sha256:".length + 8)
}

export function shortCoreCommit(identity: RuntimeIdentity): string {
  if (!isValidCoreCommit(identity.coreCommit)) return UNKNOWN
  return identity.coreCommit.slice(0, 8)
}

export function formatStartupIdentityLine(identity: RuntimeIdentity): string {
  return `LiteLLM Runtime Identity plugin=${identity.pluginVersion} artifact=${shortArtifactDigest(identity)} core=${shortCoreCommit(identity)}`
}
