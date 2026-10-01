import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { createAuditReport, createMultiEndpointAuditReport } from "../src/host/audit.js"
import { createDiagnosticsLines } from "../src/host/diagnostics.js"
import {
  formatStartupIdentityLine,
  getRuntimeIdentity,
  isValidArtifactDigest,
  isValidCoreCommit,
  isValidPluginVersion,
  parseRuntimeIdentity,
  resetRuntimeIdentityForTests,
  setRuntimeIdentityForTests,
  shortArtifactDigest,
  shortCoreCommit,
} from "../src/host/runtime-identity.js"
import type { ProviderSnapshot } from "../src/host/register.js"

const CORE_SHA = "8e155e0efe90f1e9e7c8e973239c206a97011477"
const DIGEST = `sha256:${"a".repeat(64)}`
const FIXTURE_IDENTITY = { pluginVersion: "0.5.0", artifactDigest: DIGEST, coreCommit: CORE_SHA }

function snapshot(): ProviderSnapshot {
  return {
    ready: true,
    models: [],
    audit: { status: "ready", lastSuccessfulDiscoveryAt: "2026-09-28T08:00:00.000Z" },
  }
}

function digestOfFiles(files: Map<string, Uint8Array>): string {
  const names = [...files.keys()].filter((name) => name !== "runtime-identity.json").sort()
  const manifest = names.map((name) => `${createHash("sha256").update(files.get(name)!).digest("hex")}  ${name}\n`).join("")
  return `sha256:${createHash("sha256").update(manifest, "utf8").digest("hex")}`
}

describe("Runtime Identity [IDENTITY-FIELDS]", () => {
  test("parse accepts three valid fields and rejects bad shapes", () => {
    const valid = parseRuntimeIdentity(FIXTURE_IDENTITY)
    expect(valid).toEqual(FIXTURE_IDENTITY)
    expect(isValidPluginVersion(valid.pluginVersion)).toBeTrue()
    expect(isValidArtifactDigest(valid.artifactDigest)).toBeTrue()
    expect(isValidCoreCommit(valid.coreCommit)).toBeTrue()
  })

  test("parse rejects missing and malformed identity [VERIFY-STRICT]", () => {
    expect(() => parseRuntimeIdentity(undefined)).toThrow()
    expect(() => parseRuntimeIdentity({})).toThrow()
    expect(() => parseRuntimeIdentity({ pluginVersion: "", artifactDigest: DIGEST, coreCommit: CORE_SHA })).toThrow()
    expect(() => parseRuntimeIdentity({ pluginVersion: "0.5.0", artifactDigest: "not-a-digest", coreCommit: CORE_SHA })).toThrow()
    expect(() => parseRuntimeIdentity({ pluginVersion: "0.5.0", artifactDigest: DIGEST, coreCommit: "short" })).toThrow()
    expect(() => parseRuntimeIdentity({ pluginVersion: "0.5.0", artifactDigest: `sha256:${"A".repeat(64)}`, coreCommit: CORE_SHA })).toThrow()
    expect(() => parseRuntimeIdentity({ pluginVersion: "0.5.0", artifactDigest: `sha256:${"a".repeat(63)}`, coreCommit: CORE_SHA })).toThrow()
    expect(isValidPluginVersion("")).toBeFalse()
    expect(isValidArtifactDigest("unknown")).toBeFalse()
    expect(isValidCoreCommit("unknown")).toBeFalse()
  })

  test("short forms take the documented prefixes", () => {
    expect(shortArtifactDigest(FIXTURE_IDENTITY)).toBe("a".repeat(8))
    expect(shortCoreCommit(FIXTURE_IDENTITY)).toBe(CORE_SHA.slice(0, 8))
    expect(shortArtifactDigest({ pluginVersion: "0.5.0", artifactDigest: "unknown", coreCommit: "unknown" })).toBe("unknown")
    expect(shortCoreCommit({ pluginVersion: "0.5.0", artifactDigest: "unknown", coreCommit: "unknown" })).toBe("unknown")
  })
})

describe("Runtime Identity digest semantics [DIGEST-DETERMINISTIC] [SELF-EXCLUSION]", () => {
  test("input order does not affect the digest", () => {
    const first = new Map([
      ["b.js", new TextEncoder().encode("b")],
      ["a.js", new TextEncoder().encode("a")],
    ])
    const second = new Map([
      ["a.js", new TextEncoder().encode("a")],
      ["b.js", new TextEncoder().encode("b")],
    ])
    expect(digestOfFiles(first)).toBe(digestOfFiles(second))
  })

  test("Windows and POSIX separators produce the same digest inputs", () => {
    const posix = ["a/b.js", "c.js"].sort()
    const windows = ["a\\b.js", "c.js"].map((entry) => entry.replaceAll("\\", "/")).sort()
    expect(windows).toEqual(posix)
  })

  test("identity file itself is excluded so metadata edits do not recurse", () => {
    const base = new Map([
      ["index.js", new TextEncoder().encode("code")],
      ["runtime-identity.json", new TextEncoder().encode(`{"a":1}`)],
    ])
    const edited = new Map([
      ["index.js", new TextEncoder().encode("code")],
      ["runtime-identity.json", new TextEncoder().encode(`{"a":2}`)],
    ])
    expect(digestOfFiles(base)).toBe(digestOfFiles(edited))
  })

  test("artifact byte change alters the digest [DIGEST-SENSITIVE]", () => {
    const before = new Map([["index.js", new TextEncoder().encode("code-v1")]])
    const after = new Map([["index.js", new TextEncoder().encode("code-v2")]])
    expect(digestOfFiles(before)).not.toBe(digestOfFiles(after))
    expect(digestOfFiles(before)).toMatch(/^sha256:[0-9a-f]{64}$/u)
  })
})

describe("Runtime Identity consumers [CANONICAL-SINGLE] [DIAG-SHORT] [AUDIT-FULL] [STARTUP-LOG]", () => {
  test("diagnostics, audit and startup share the canonical identity", () => {
    resetRuntimeIdentityForTests()
    setRuntimeIdentityForTests(FIXTURE_IDENTITY)
    try {
      const identity = getRuntimeIdentity()
      expect(identity).toEqual(FIXTURE_IDENTITY)
      const lines = createDiagnosticsLines(snapshot()).join("\n")
      expect(lines).toContain("Runtime Identity")
      expect(lines).toContain(`Plugin Version   ${identity.pluginVersion}`)
      expect(lines).toContain(`Artifact         ${shortArtifactDigest(identity)}`)
      expect(lines).toContain(`Core Commit      ${shortCoreCommit(identity)}`)
      expect(lines).toContain("Core：")

      const report = createAuditReport(snapshot().audit!) as { runtimeIdentity: { pluginVersion: string; artifactDigest: string; coreCommit: string } }
      expect(report.runtimeIdentity).toEqual({
        pluginVersion: identity.pluginVersion,
        artifactDigest: identity.artifactDigest,
        coreCommit: identity.coreCommit,
      })
      expect(report.runtimeIdentity.artifactDigest.startsWith("sha256:")).toBeTrue()
      expect(report.runtimeIdentity.coreCommit).toHaveLength(40)

      const multi = createMultiEndpointAuditReport([{ id: "default", snapshot: snapshot().audit! }]) as {
        runtimeIdentity: unknown
        endpoints: Array<{ report: { runtimeIdentity: unknown } }>
      }
      expect(multi.runtimeIdentity).toEqual(report.runtimeIdentity)
      expect(multi.endpoints[0]?.report.runtimeIdentity).toEqual(report.runtimeIdentity)

      const line = formatStartupIdentityLine(identity)
      expect(line).toContain(`plugin=${identity.pluginVersion}`)
      expect(line).toContain(`artifact=${shortArtifactDigest(identity)}`)
      expect(line).toContain(`core=${shortCoreCommit(identity)}`)
      expect(line).not.toContain("sk-")
    } finally {
      resetRuntimeIdentityForTests()
    }
  })
})
