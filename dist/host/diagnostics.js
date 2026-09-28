import { readFileSync } from "node:fs";
function readJSON(url) {
    try {
        return JSON.parse(readFileSync(url, "utf8"));
    }
    catch {
        return undefined;
    }
}
export function runtimeBuildInfo() {
    const manifest = readJSON(new URL("../../package.json", import.meta.url));
    const provenance = readJSON(new URL("../core-provenance.json", import.meta.url)) ??
        readJSON(new URL("../../dist/core-provenance.json", import.meta.url));
    return {
        pluginVersion: typeof manifest?.version === "string" ? manifest.version : "unknown",
        coreSHA: typeof provenance?.sha === "string" ? provenance.sha : "unknown",
        coreBranch: typeof provenance?.branch === "string" ? provenance.branch : "unknown",
    };
}
function ageText(ageMs) {
    if (ageMs === undefined)
        return "未知";
    if (ageMs < 1_000)
        return "<1秒";
    if (ageMs < 60_000)
        return `${Math.floor(ageMs / 1_000)}秒`;
    if (ageMs < 3_600_000)
        return `${Math.floor(ageMs / 60_000)}分钟`;
    return `${Math.floor(ageMs / 3_600_000)}小时`;
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
};
export function createDiagnosticsLines(snapshot, now = Date.now()) {
    const build = runtimeBuildInfo();
    const audit = snapshot.audit ?? { status: "disconnected" };
    const lines = [
        `LiteLLM Diagnostics · OpenCode ${build.pluginVersion}`,
        `状态：${STATUS_TEXT[audit.status]}`,
        `已注册模型：${audit.view?.models.length ?? snapshot.models.length}`,
    ];
    if (audit.lastSuccessfulDiscoveryAt)
        lines.push(`最近成功发现：${audit.lastSuccessfulDiscoveryAt}`);
    const cache = snapshot.diagnostics?.cache;
    if (cache) {
        const age = cache.refreshedAt === undefined ? cache.ageMs : Math.max(0, now - cache.refreshedAt);
        lines.push(`缓存：${cache.source} · stale=${cache.stale ? "是" : "否"} · age=${ageText(age)} · failures=${cache.failureCount}`);
        if (cache.nextRetryAt !== undefined)
            lines.push(`下次允许重试：${new Date(cache.nextRetryAt).toISOString()}`);
    }
    const discovery = snapshot.diagnostics?.discovery;
    if (discovery) {
        lines.push(`/v1/model/info：${discovery.modelInfo.status} · /v1/models：未作为发现源`, `models.dev：${discovery.modelsDev.status} · 命中 ${discovery.stats.modelsDevMatched}/${discovery.stats.models}`, `协议 fallback：${discovery.stats.protocolFallbacks} · 过滤条目：${discovery.stats.filteredEntries}`);
        const warnings = discovery.issues.filter((issue) => issue.severity !== "info");
        lines.push(`诊断告警：${warnings.length}`);
        const examples = warnings.slice(0, 3).map((issue) => issue.modelId ? `${issue.modelId}: ${issue.code}` : issue.code);
        if (examples.length > 0)
            lines.push(`重点：${examples.join("；")}`);
    }
    if (snapshot.diagnostics?.note)
        lines.push(`说明：${snapshot.diagnostics.note}`);
    lines.push(`Core：${build.coreBranch}@${build.coreSHA}`);
    return lines;
}
