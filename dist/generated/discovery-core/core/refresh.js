export const DEFAULT_DISCOVERY_TTL_MS = 30_000;
export const DEFAULT_DISCOVERY_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
function positiveFinite(value, name) {
    if (!Number.isFinite(value) || value <= 0)
        throw new Error(`${name} must be a positive finite number`);
    return value;
}
function normalizeBackoff(values) {
    if (values.length === 0)
        throw new Error("backoffMs must contain at least one delay");
    return values.map((value, index) => positiveFinite(value, `backoffMs[${index}]`));
}
function emptyEntry() {
    return { hasValue: false, expiresAt: 0, failureCount: 0, retryAt: 0 };
}
export function createDiscoveryCoordinator(options = {}) {
    const ttlMs = positiveFinite(options.ttlMs ?? DEFAULT_DISCOVERY_TTL_MS, "ttlMs");
    const backoffMs = normalizeBackoff(options.backoffMs ?? DEFAULT_DISCOVERY_BACKOFF_MS);
    const now = options.now ?? Date.now;
    const defaultFailurePolicy = options.failurePolicy ?? (() => "stale");
    const entries = new Map();
    const entryFor = (key) => {
        const existing = entries.get(key);
        if (existing)
            return existing;
        const created = emptyEntry();
        entries.set(key, created);
        return created;
    };
    const resultFromEntry = (entry, source) => {
        if (!entry.hasValue)
            throw new Error("refresh coordinator entry has no cached value");
        return {
            value: entry.value,
            source,
            stale: source === "stale",
            refreshedAt: entry.refreshedAt ?? 0,
            failureCount: entry.failureCount,
            nextRetryAt: entry.retryAt > 0 ? entry.retryAt : undefined,
            error: source === "stale" ? entry.lastError : undefined,
        };
    };
    const refresh = (key, discover, request = {}) => {
        const entry = entryFor(key);
        if (entry.pending)
            return entry.pending;
        const startedAt = now();
        if (!request.forceRefresh) {
            if (entry.retryAt > startedAt) {
                if (entry.hasValue)
                    return Promise.resolve(resultFromEntry(entry, "stale"));
                return Promise.reject(entry.lastError ?? new Error("discovery retry is in backoff"));
            }
            if (entry.hasValue && startedAt < entry.expiresAt) {
                return Promise.resolve(resultFromEntry(entry, "cache"));
            }
        }
        let pending;
        pending = Promise.resolve()
            .then(discover)
            .then((value) => {
            const completedAt = now();
            entry.hasValue = true;
            entry.value = value;
            entry.refreshedAt = completedAt;
            entry.expiresAt = completedAt + ttlMs;
            entry.failureCount = 0;
            entry.retryAt = 0;
            entry.lastError = undefined;
            return {
                value,
                source: "network",
                stale: false,
                refreshedAt: completedAt,
                failureCount: 0,
            };
        })
            .catch((error) => {
            const policy = request.failurePolicy?.(error) ?? defaultFailurePolicy(error);
            if (policy === "ignore")
                throw error;
            if (policy === "clear") {
                entry.hasValue = false;
                entry.value = undefined;
                entry.refreshedAt = undefined;
                entry.expiresAt = 0;
                entry.failureCount = 0;
                entry.retryAt = 0;
                entry.lastError = error;
                throw error;
            }
            const failedAt = now();
            entry.failureCount += 1;
            const delay = backoffMs[Math.min(entry.failureCount - 1, backoffMs.length - 1)];
            entry.retryAt = failedAt + delay;
            entry.lastError = error;
            if (entry.hasValue)
                return resultFromEntry(entry, "stale");
            throw error;
        })
            .finally(() => {
            if (entry.pending === pending)
                entry.pending = undefined;
        });
        entry.pending = pending;
        return pending;
    };
    return {
        refresh,
        state(key) {
            const entry = entries.get(key);
            if (!entry)
                return { hasValue: false, failureCount: 0, pending: false };
            return {
                hasValue: entry.hasValue,
                value: entry.hasValue ? entry.value : undefined,
                refreshedAt: entry.refreshedAt,
                expiresAt: entry.hasValue ? entry.expiresAt : undefined,
                failureCount: entry.failureCount,
                nextRetryAt: entry.retryAt > 0 ? entry.retryAt : undefined,
                pending: entry.pending !== undefined,
                lastError: entry.lastError,
            };
        },
        retryDelayMs(key) {
            const entry = entries.get(key);
            if (!entry || entry.retryAt === 0)
                return undefined;
            return Math.max(0, entry.retryAt - now());
        },
        clear(key) {
            entries.delete(key);
        },
        clearAll() {
            entries.clear();
        },
    };
}
