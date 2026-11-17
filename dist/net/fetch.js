import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { normalizeModelsDevCatalog } from "../generated/discovery-core/index.js";
export class DiscoveryError extends Error {
    kind;
    status;
    constructor(kind, message, status) {
        super(message);
        this.kind = kind;
        this.status = status;
        this.name = "DiscoveryError";
    }
}
const MODELS_DEV_URL = "https://models.dev/catalog.json";
const MODELS_DEV_RETRY_MS = 60 * 1000;
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function safeURL(raw) {
    try {
        const url = new URL(raw);
        url.username = "";
        url.password = "";
        return url.toString();
    }
    catch {
        return raw.replace(/\/\/[^/@\s]+@/g, "//***@");
    }
}
export function redact(value, key) {
    let output = value;
    if (key)
        output = output.replace(new RegExp(escapeRegExp(key), "g"), "sk-***");
    output = output.replace(/sk-[A-Za-z0-9_-]+/g, "sk-***");
    return output;
}
function statusError(url, status, key) {
    const safe = redact(safeURL(url), key);
    if (status >= 300 && status < 400) {
        return new DiscoveryError("redirect", `请求 ${safe} 返回重定向状态 ${status}，请检查 LiteLLM 地址`, status);
    }
    if (status === 401 || status === 403) {
        return new DiscoveryError("auth", `请求 ${safe} 返回 ${status}：Key 无效或无权限`, status);
    }
    if (status === 404)
        return new DiscoveryError("notfound", `请求 ${safe} 返回 404`, status);
    if (status === 429)
        return new DiscoveryError("ratelimit", `请求 ${safe} 返回 429`, status);
    if (status >= 500)
        return new DiscoveryError("server", `请求 ${safe} 返回服务器错误 ${status}`, status);
    return new DiscoveryError("network", `请求 ${safe} 返回 HTTP ${status}`, status);
}
export async function fetchJSON(options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    const fetchImpl = options.fetchImpl ?? fetch;
    try {
        const response = await fetchImpl(options.url, {
            method: "GET",
            redirect: "manual",
            signal: controller.signal,
            headers: options.key ? { Authorization: `Bearer ${options.key}` } : undefined,
        });
        if (!response.ok)
            throw statusError(options.url, response.status, options.key);
        try {
            return await response.json();
        }
        catch {
            throw new DiscoveryError("parse", `请求 ${redact(safeURL(options.url), options.key)} 的响应不是有效 JSON`, response.status);
        }
    }
    catch (error) {
        if (error instanceof DiscoveryError)
            throw error;
        const timedOut = controller.signal.aborted;
        const detail = error instanceof Error ? error.message : String(error);
        const reason = timedOut ? "请求超时" : redact(detail, options.key);
        throw new DiscoveryError("network", `${reason}：${redact(safeURL(options.url), options.key)}`);
    }
    finally {
        clearTimeout(timeout);
    }
}
export async function fetchLiteLLMModelInfo(addresses, key, fetchImpl) {
    try {
        return await fetchJSON({ url: addresses.modelInfoURL, key, timeoutMs: 15_000, fetchImpl });
    }
    catch (error) {
        if (!(error instanceof DiscoveryError) || error.kind !== "notfound")
            throw error;
        return fetchJSON({ url: addresses.legacyModelInfoURL, key, timeoutMs: 15_000, fetchImpl });
    }
}
const catalogCaches = new Map();
export async function getModelsDevCatalog(options = {}) {
    const url = options.url ?? MODELS_DEV_URL;
    // Injected transports are isolated unless persistence is explicitly requested.
    const cachePath = options.cachePath === false ? undefined : options.cachePath ??
        (options.fetchImpl ? undefined : join(homedir(), ".cache", "litellm-provider", "models-dev", createHash("sha256").update(url).digest("hex") + ".json"));
    const cacheKey = JSON.stringify([url, cachePath]);
    let existingCache = catalogCaches.get(cacheKey);
    if (!existingCache) {
        existingCache = { retryAt: 0 };
        if (cachePath) {
            try {
                const saved = JSON.parse(readFileSync(cachePath, "utf8"));
                if (saved.url === url && normalizeModelsDevCatalog(saved.catalog).kind === "complete") {
                    existingCache.value = saved.catalog;
                }
            }
            catch { /* Missing or unreadable cache is a cold start. */ }
        }
        catalogCaches.set(cacheKey, existingCache);
    }
    const catalogCache = existingCache;
    const now = options.now?.() ?? Date.now();
    if (!options.forceRefresh && catalogCache.value !== undefined)
        return catalogCache.value;
    if (options.cachedOnly)
        return undefined;
    if (now < catalogCache.retryAt)
        return catalogCache.value ?? {};
    if (catalogCache.pending)
        return catalogCache.pending;
    const request = fetchJSON({
        url,
        timeoutMs: 60_000,
        fetchImpl: options.fetchImpl,
    })
        .then((value) => {
        if (normalizeModelsDevCatalog(value).kind !== "complete" && normalizeModelsDevCatalog(catalogCache.value).kind === "complete") {
            return catalogCache.value;
        }
        catalogCache.value = value;
        catalogCache.retryAt = 0;
        if (cachePath && normalizeModelsDevCatalog(value).kind === "complete") {
            try {
                mkdirSync(dirname(cachePath), { recursive: true });
                const temporary = cachePath + "." + randomUUID() + ".tmp";
                writeFileSync(temporary, JSON.stringify({ url, catalog: value }), { mode: 0o600 });
                renameSync(temporary, cachePath);
            }
            catch { /* Disk cache is best effort; successful discovery still works. */ }
        }
        return value;
    })
        .catch((error) => {
        const failedAt = options.now?.() ?? Date.now();
        catalogCache.retryAt = failedAt + MODELS_DEV_RETRY_MS;
        const message = error instanceof Error ? error.message : String(error);
        options.logger?.warn(`models.dev 获取失败，暂不补充模型元数据：${redact(message)}`);
        return catalogCache.value ?? {};
    })
        .finally(() => {
        catalogCache.pending = undefined;
    });
    catalogCache.pending = request;
    return request;
}
export function resetModelsDevCacheForTest() {
    catalogCaches.clear();
}
