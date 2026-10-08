import { describe, expect, test } from "bun:test"
import { createDiagnosticsLines, formatHostDateTime, formatModelDetails } from "../src/host/diagnostics.js"
import type { ProviderSnapshot } from "../src/host/register.js"

describe("OpenCode diagnostics", () => {
  test("renders absolute timestamps in the host timezone without changing the stored instant", () => {
    const instant = "2026-09-29T01:07:32.160Z"
    expect(formatHostDateTime(instant, -480)).toBe("2026-09-29 09:07:32 UTC+08:00")

    const snapshot: ProviderSnapshot = {
      ready: true,
      models: [],
      audit: {
        status: "ready",
        lastSuccessfulDiscoveryAt: instant,
      },
      diagnostics: {
        cache: {
          source: "stale",
          stale: true,
          refreshedAt: Date.parse(instant),
          ageMs: 0,
          failureCount: 1,
          nextRetryAt: Date.parse("2026-09-29T01:10:00.000Z"),
          pending: false,
        },
      },
    }
    const text = createDiagnosticsLines(
      snapshot,
      Date.parse("2026-09-29T01:08:32.160Z"),
      -480,
    ).join("\n")
    expect(text).toContain("最近成功发现：2026-09-29 09:07:32 UTC+08:00")
    expect(text).toContain("下次允许重试：2026-09-29 09:10:00 UTC+08:00")
    expect(snapshot.audit?.lastSuccessfulDiscoveryAt).toBe(instant)
  })

  test("renders safe shared discovery and cache summary", () => {
    const snapshot: ProviderSnapshot = {
      ready: true,
      connection: {
        type: "credential",
        id: "sk-secret",
        label: "https://private.example",
        method: "key",
      },
      apiBaseURL: "https://private.example/v1",
      models: [],
      audit: {
        status: "ready",
        lastSuccessfulDiscoveryAt: "2026-09-28T08:00:00.000Z",
      },
      diagnostics: {
        cache: {
          source: "network",
          stale: false,
          refreshedAt: Date.parse("2026-09-28T08:00:00.000Z"),
          ageMs: 0,
          failureCount: 0,
          pending: false,
        },
        discovery: {
          schemaVersion: 1,
          modelInfo: {
            status: "ok",
            primaryPath: "/v1/model/info",
            fallbackPath: "/model/info",
          },
          modelsList: {
            status: "unused",
            path: "/v1/models",
            reason: "not authoritative",
          },
          modelsDev: { status: "degraded" },
          stats: {
            responseEntries: 2,
            deployments: 1,
            filteredEntries: 1,
            models: 1,
            modelsDevMatched: 0,
            modelsDevUnmatched: 1,
            protocolFallbacks: 1,
          },
          models: [],
          issues: [{
            severity: "warning",
            stage: "models-dev",
            code: "models-dev-unmatched",
            modelId: "model-a",
            message: "safe",
          }],
        },
      },
    }
    const text = createDiagnosticsLines(snapshot, Date.parse("2026-09-28T08:01:00.000Z")).join("\n")
    expect(text).toContain("/v1/models：未作为发现源")
    expect(text).toContain("models.dev：degraded")
    expect(text).toContain("协议 fallback：1")
    expect(text).toContain("model-a: models-dev-unmatched")
    expect(text).toContain("Core：")
    expect(text).not.toContain("sk-secret")
    expect(text).not.toContain("private.example")
  })
})

describe("canonical catalog model details (OpenCode)", () => {
  function discoveryWith(models: unknown[]) {
    return { models } as never
  }

  test("新 Core 全字段渲染 canonical/serving/档位/operator-config/候选/shape", () => {
    const lines = formatModelDetails(discoveryWith([{
      id: "m",
      deploymentCount: 1,
      quality: {
        identity: { canonicalModelID: "labA/m", canonicalEvidence: "registry-unique", canonicalStatus: "proven" },
        serving: { status: "serving-record-unresolved", providerID: "gatewayX" },
        reasoningLevelsState: "unknown",
        operatorConfigurationKeys: ["litellm_params.reasoning_effort"],
        diagnosticCandidates: [{ providerID: "gatewayX", recordID: "m-free" }],
        catalogKind: "complete",
      },
      publication: { reasoningLevels: [] },
    }]))
    const text = lines.join("\n")
    expect(text).toContain("canonical labA/m（registry-unique）")
    expect(text).toContain("serving serving-record-unresolved gatewayX")
    expect(text).toContain("档位 unknown")
    expect(text).toContain("operator configuration")
    expect(text).not.toContain("hard-enforced")
    expect(text).toContain("gatewayX/m-free")
  })

  test("旧 Core 缺失字段时省略对应行；空列表无明细块", () => {
    const lines = formatModelDetails(discoveryWith([{
      id: "m",
      deploymentCount: 1,
      quality: {},
      publication: {},
    }]))
    const text = lines.join("\n")
    expect(text).toContain("m · 部署 1")
    expect(text).not.toContain("canonical")
    expect(text).not.toContain("serving")
    expect(text).not.toContain("档位")
    expect(formatModelDetails(undefined)).toEqual([])
    expect(formatModelDetails(discoveryWith([]))).toEqual([])
  })
})
