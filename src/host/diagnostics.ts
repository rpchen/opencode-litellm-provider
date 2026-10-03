import { readFileSync } from "node:fs"
import type { ProviderSnapshot } from "./register.js"
import type { PublicationSummary } from "./publication.js"
import { getRuntimeIdentity, shortArtifactDigest, shortCoreCommit } from "./runtime-identity.js"

interface PackageManifest { version?: unknown }
interface CoreProvenance { sha?: unknown; branch?: unknown }

function readJSON<T>(url: URL): T | undefined {
  try {
    return JSON.parse(readFileSync(url, "utf8")) as T
  } catch {
    return undefined
  }
}

export function runtimeBuildInfo(): { pluginVersion: string; coreSHA: string; coreBranch: string } {
  const identity = getRuntimeIdentity()
  if (identity.pluginVersion !== "unknown") {
    const provenance =
      readJSON<CoreProvenance>(new URL("../core-provenance.json", import.meta.url)) ??
      readJSON<CoreProvenance>(new URL("../../dist/core-provenance.json", import.meta.url))
    return {
      pluginVersion: identity.pluginVersion,
      coreSHA: identity.coreCommit,
      coreBranch: typeof provenance?.branch === "string" ? provenance.branch : "unknown",
    }
  }
  const manifest = readJSON<PackageManifest>(new URL("../../package.json", import.meta.url))
  const provenance =
    readJSON<CoreProvenance>(new URL("../core-provenance.json", import.meta.url)) ??
    readJSON<CoreProvenance>(new URL("../../dist/core-provenance.json", import.meta.url))
  return {
    pluginVersion: typeof manifest?.version === "string" ? manifest.version : "unknown",
    coreSHA: typeof provenance?.sha === "string" ? provenance.sha : "unknown",
    coreBranch: typeof provenance?.branch === "string" ? provenance.branch : "unknown",
  }
}

function ageText(ageMs: number | undefined): string {
  if (ageMs === undefined) return "未知"
  if (ageMs < 1_000) return "<1秒"
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1_000)}秒`
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}分钟`
  return `${Math.floor(ageMs / 3_600_000)}小时`
}

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

/**
 * Format an instant in the timezone configured on the running OpenCode host.
 * The optional offset exists only for deterministic tests.
 */
export function formatHostDateTime(
  value: string | number | Date,
  timezoneOffsetMinutes?: number,
): string {
  const instant = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(instant.getTime())) return String(value)

  const offset = timezoneOffsetMinutes ?? instant.getTimezoneOffset()
  const local = new Date(instant.getTime() - offset * 60_000)
  const displayOffset = -offset
  const sign = displayOffset >= 0 ? "+" : "-"
  const absoluteOffset = Math.abs(displayOffset)
  const offsetHours = Math.floor(absoluteOffset / 60)
  const offsetMinutes = absoluteOffset % 60

  return [
    `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())}`,
    `${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}:${pad2(local.getUTCSeconds())}`,
    `UTC${sign}${pad2(offsetHours)}:${pad2(offsetMinutes)}`,
  ].join(" ")
}

const STATUS_TEXT = {
  disconnected: "未连接",
  pending: "等待首次发现",
  switching: "连接切换中",
  ready: "正常",
  empty: "发现成功，但没有可用模型",
  stale: "使用 last-known-good",
  "cleared-auth": "认证失败，模型已清空",
  "cleared-notfound": "model/info 不可用，模型已清空",
} as const

/** Render the Core publication partition: states, gaps, LKG, degraded. */
export function formatPublicationLines(summary: PublicationSummary | undefined, acceptedPending: readonly string[] = []): string[] {
  if (!summary && acceptedPending.length === 0) return [];
  const published = summary?.publishable.length ?? 0;
  const blockedList = summary?.blocked ?? [];
  const degradedIDs = summary?.degradedIDs ?? [];
  const lkgIDs = summary?.lkgIDs ?? [];
  const out = [
    `可用 ${published} · 未完成 ${blockedList.length} · 降级 ${degradedIDs.length} · LKG ${lkgIDs.length}`,
  ];
  if (summary?.failureKind) out.push(`元数据获取失败：${summary.failureKind}`);
  if (lkgIDs.length > 0) out.push(`LKG 提供：${lkgIDs.join("、")}`);
  if (degradedIDs.length > 0) out.push(`已接受降级：${degradedIDs.join("、")}`);
  if (acceptedPending.length > 0) out.push(`已接受、待下次刷新生效：${acceptedPending.join("、")}`);
  for (const blocked of blockedList.slice(0, 5)) {
    out.push(`未完成：${blocked.id} · ${blocked.status} · 缺失 ${blocked.gaps.join("、")}`);
  }
  if (blockedList.length > 5) out.push(`另有 ${blockedList.length - 5} 个未完成模型`);
  return out;
}

/** Accepted-but-not-yet-applied degraded ids (visible until the next refresh applies them). */
export function pendingAcceptanceIDs(snapshot: ProviderSnapshot): string[] {
  const accepted = snapshot.publicationState?.acceptedDegradedIDs
  if (!accepted || accepted.size === 0) return [];
  const applied = new Set(snapshot.diagnostics?.publication?.degradedIDs ?? []);
  return [...accepted].filter((id) => !applied.has(id));
}

export function createDiagnosticsLines(
  snapshot: ProviderSnapshot,
  now = Date.now(),
  timezoneOffsetMinutes?: number,
): string[] {
  const build = runtimeBuildInfo()
  const audit = snapshot.audit ?? { status: "disconnected" as const }
  const lines = [
    `LiteLLM Diagnostics · OpenCode ${build.pluginVersion}`,
    `状态：${STATUS_TEXT[audit.status]}`,
    `已注册模型：${audit.view?.models.length ?? snapshot.models.length}`,
  ]

  if (audit.lastSuccessfulDiscoveryAt) {
    lines.push(`最近成功发现：${formatHostDateTime(audit.lastSuccessfulDiscoveryAt, timezoneOffsetMinutes)}`)
  }

  const cache = snapshot.diagnostics?.cache
  if (cache) {
    const age = cache.refreshedAt === undefined ? cache.ageMs : Math.max(0, now - cache.refreshedAt)
    lines.push(
      `缓存：${cache.source} · stale=${cache.stale ? "是" : "否"} · age=${ageText(age)} · failures=${cache.failureCount}`,
    )
    if (cache.nextRetryAt !== undefined) {
      lines.push(`下次允许重试：${formatHostDateTime(cache.nextRetryAt, timezoneOffsetMinutes)}`)
    }
  }

  const discovery = snapshot.diagnostics?.discovery
  if (discovery) {
    lines.push(
      `/v1/model/info：${discovery.modelInfo.status} · /v1/models：未作为发现源`,
      `models.dev：${discovery.modelsDev.status} · 命中 ${discovery.stats.modelsDevMatched}/${discovery.stats.models}`,
      `协议 fallback：${discovery.stats.protocolFallbacks} · 过滤条目：${discovery.stats.filteredEntries}`,
    )
    const warnings = discovery.issues.filter((issue) => issue.severity !== "info")
    lines.push(`诊断告警：${warnings.length}`)
    const examples = warnings.slice(0, 3).map((issue) =>
      issue.modelId ? `${issue.modelId}: ${issue.code}` : issue.code
    )
    if (examples.length > 0) lines.push(`重点：${examples.join("；")}`)
  }

  if (snapshot.diagnostics?.note) lines.push(`说明：${snapshot.diagnostics.note}`)
  lines.push(...formatPublicationLines(
    snapshot.diagnostics?.publication,
    pendingAcceptanceIDs(snapshot),
  ))
  lines.push(`Core：${build.coreBranch}@${build.coreSHA}`)
  const identity = getRuntimeIdentity()
  lines.push(
    "Runtime Identity",
    `Plugin Version   ${identity.pluginVersion}`,
    `Artifact         ${shortArtifactDigest(identity)}`,
    `Core Commit      ${shortCoreCommit(identity)}`,
  )
  return lines
}
