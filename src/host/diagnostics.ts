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
  disconnected: "尚未发现 LiteLLM",
  pending: "等待首次发现",
  switching: "连接切换中",
  ready: "正常",
  empty: "发现成功，但没有可用模型",
  stale: "使用 last-known-good",
  "cleared-auth": "认证失败，模型已清空",
  "cleared-notfound": "model/info 不可用，模型已清空",
} as const

/** Render the Core publication partition: availability, withheld reasons, LKG, evidence. */
export function formatPublicationLines(summary: PublicationSummary | undefined): string[] {
  if (!summary) return [];
  const out = [
    `发现 ${summary.discovered} · 可用 ${summary.publishable.length} · withheld ${summary.withheld.length} · LKG ${summary.lkgIDs.length}`,
  ];
  if (summary.unusable) {
    out.push(
      "catalog 当前不可用：endpoint 连接成功，但本轮没有任何模型达到可信发布标准。",
      "下一步：稍后刷新（Retry）重新发现，或运行 /litellm-diagnostics 查看每个模型的 withheld 原因。插件不会用默认值或确认动作强行发布模型。",
    );
  } else if (summary.partial) {
    out.push(
      `部分可用：${summary.publishable.length} 个模型正常发布，${summary.withheld.length} 个 withheld（其余模型不受影响，无需确认）。`,
    );
  }
  if (summary.failureKind) out.push(`元数据获取失败：${summary.failureKind}（未用默认值伪装完整配置）`);
  // Notification state, not publication state: tells the user why the same
  // problem set stays quiet across restarts.
  if (summary.acknowledgement.reason === "unchanged") {
    out.push("提醒状态：该问题集合已确认（跨重启保留），不重复提醒");
  } else if (summary.acknowledgement.reason === "improved") {
    out.push("提醒状态：问题集合较已确认状态减少，基线已更新");
  }
  if (summary.regressions.length > 0) {
    out.push(
      `此前可用、现已撤下：${summary.regressions.join("、")}（这些模型当前不可安全使用；插件不会自动切换到其他模型）`,
    );
  }
  if (summary.lkgIDs.length > 0) {
    out.push(`使用已信任的前次完整配置（LKG）：${summary.lkgIDs.join("、")}`);
    if (summary.lkgDetail) out.push(`LKG 说明：${summary.lkgDetail}`);
  }
  for (const model of summary.withheld.slice(0, 5)) {
    const reasons = model.reasons.map((item) => item.code).join("+") || "withheld";
    out.push(
      `withheld：${model.id} · ${model.status} · ${reasons}${model.retryable ? " · 可重试" : ""}${model.previouslyPublished ? " · 此前可用" : ""}`,
    );
  }
  if (summary.withheld.length > 5) out.push(`……另有 ${summary.withheld.length - 5} 个 withheld 模型`);
  for (const fact of summary.discrepancies.slice(0, 5)) {
    out.push(`已裁决差异：${fact.model} · ${fact.field} · ${fact.resolution}`);
  }
  for (const fact of summary.conflicts.slice(0, 5)) {
    out.push(`未决冲突：${fact.model} · ${fact.field} · ${fact.resolution}`);
  }
  return out;
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
  lines.push(...formatPublicationLines(snapshot.diagnostics?.publication))
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
