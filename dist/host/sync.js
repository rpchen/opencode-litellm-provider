import { buildModelSpecs, modelFingerprint, toOpenCodeModelSpec } from "../core/build.js";
import { createDiscoveryCacheDiagnostics, diagnoseModelSpecs, } from "../core/diagnostics.js";
import { normalizeLiteLLMURL } from "../core/litellm.js";
import { createDiscoveryCoordinator } from "../core/refresh.js";
import { compareDiscoverySnapshots, createDiscoverySnapshot, endpointFingerprint, inspectDiscoverySnapshot, } from "../core/snapshot.js";
import { endpointIdentity } from "../endpoints.js";
import { DiscoveryError, fetchLiteLLMModelInfo, getModelsDevCatalog, redact, } from "../net/fetch.js";
import { createRegistrationView } from "./register.js";
const DISCOVERY_SNAPSHOT_STORAGE_KEY = "litellm.discovery.snapshot.v1";
const DEFAULT_ENDPOINT = endpointIdentity("default", undefined, true);
/** Storage key of an endpoint's persisted discovery snapshot (legacy default keeps the unsuffixed key). */
export function discoverySnapshotKey(endpointId, legacy) {
    return legacy ? DISCOVERY_SNAPSHOT_STORAGE_KEY : `${DISCOVERY_SNAPSHOT_STORAGE_KEY}.${endpointId}`;
}
const defaultScheduler = {
    setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimeout: (handle) => clearTimeout(handle),
};
function isKeyCredential(value) {
    return typeof value === "object" && value !== null && value.type === "key" &&
        typeof value.key === "string";
}
function switchedForLiteLLM(event, integrationId) {
    if (event.type === "credential.updated")
        return true;
    if (event.type !== "credential.switched" || typeof event.data !== "object" || event.data === null)
        return false;
    return event.data.integrationID === integrationId;
}
function connectionIdentity(connection, credential, url) {
    const connectionID = connection.type === "credential" ? connection.id : connection.name;
    return `${connection.type}\u0000${connectionID}\u0000${url}\u0000${credential.key}`;
}
export function createDiscoveryLoop(context, snapshot, options, dependencies = {}, endpoint = DEFAULT_ENDPOINT) {
    const scheduler = dependencies.scheduler ?? defaultScheduler;
    const logger = dependencies.logger ?? console;
    const fetchModelInfo = dependencies.fetchLiteLLM ?? fetchLiteLLMModelInfo;
    const fetchCatalog = dependencies.getModelsDev ?? getModelsDevCatalog;
    const buildModels = dependencies.buildModels ?? buildModelSpecs;
    const fingerprint = dependencies.fingerprint ?? modelFingerprint;
    const coordinator = createDiscoveryCoordinator();
    const abortEvents = new AbortController();
    snapshot.audit ??= { status: "disconnected" };
    let timer;
    let disposed = false;
    let running;
    let queued = false;
    let identity;
    let lastFingerprint;
    let persistedIdentity;
    let persistedSnapshot;
    let reloadPending = false;
    let eventTask;
    const reload = async () => {
        reloadPending = true;
        await context.provider.reload();
        reloadPending = false;
    };
    const neutralModels = (models) => models.map(({ package: _package, ...model }) => model);
    const loadPersistedSnapshot = async (nextIdentity, expectedEndpoint) => {
        if (persistedIdentity === nextIdentity)
            return persistedSnapshot;
        persistedIdentity = nextIdentity;
        persistedSnapshot = undefined;
        if (!context.storage)
            return undefined;
        try {
            const raw = await context.storage.get(endpoint.legacy ? DISCOVERY_SNAPSHOT_STORAGE_KEY : `${DISCOVERY_SNAPSHOT_STORAGE_KEY}.${endpoint.id}`);
            const value = typeof raw === "string" ? JSON.parse(raw) : raw;
            const inspected = inspectDiscoverySnapshot(value, expectedEndpoint);
            if (inspected.compatible)
                persistedSnapshot = inspected.snapshot;
            return persistedSnapshot;
        }
        catch (error) {
            logger.warn(`LiteLLM snapshot 读取失败，继续网络发现：${redact(error instanceof Error ? error.message : String(error))}`);
            return undefined;
        }
    };
    const persistSnapshot = async (nextIdentity, value) => {
        const unchanged = persistedIdentity === nextIdentity &&
            persistedSnapshot?.endpointFingerprint === value.endpointFingerprint &&
            persistedSnapshot.modelFingerprint === value.modelFingerprint;
        if (unchanged)
            return;
        if (!context.storage) {
            persistedIdentity = nextIdentity;
            persistedSnapshot = value;
            return;
        }
        try {
            await context.storage.set(endpoint.legacy ? DISCOVERY_SNAPSHOT_STORAGE_KEY : `${DISCOVERY_SNAPSHOT_STORAGE_KEY}.${endpoint.id}`, JSON.stringify(value));
            persistedIdentity = nextIdentity;
            persistedSnapshot = value;
        }
        catch (error) {
            logger.warn(`LiteLLM snapshot 持久化失败（不影响本次发现）：${redact(error instanceof Error ? error.message : String(error))}`);
        }
    };
    const clearPersistedSnapshot = async (nextIdentity) => {
        persistedIdentity = nextIdentity;
        persistedSnapshot = undefined;
        if (!context.storage)
            return;
        try {
            if (context.storage.remove)
                await context.storage.remove(endpoint.legacy ? DISCOVERY_SNAPSHOT_STORAGE_KEY : `${DISCOVERY_SNAPSHOT_STORAGE_KEY}.${endpoint.id}`);
            else
                await context.storage.set(endpoint.legacy ? DISCOVERY_SNAPSHOT_STORAGE_KEY : `${DISCOVERY_SNAPSHOT_STORAGE_KEY}.${endpoint.id}`, "null");
        }
        catch (error) {
            logger.warn(`LiteLLM snapshot 清理失败：${redact(error instanceof Error ? error.message : String(error))}`);
        }
    };
    const cancelTimer = () => {
        if (timer !== undefined)
            scheduler.clearTimeout(timer);
        timer = undefined;
    };
    const schedule = () => {
        cancelTimer();
        if (disposed || (!snapshot.connection && !reloadPending))
            return;
        const retryDelay = identity ? coordinator.retryDelayMs(identity) : undefined;
        timer = scheduler.setTimeout(() => {
            timer = undefined;
            void trigger(false);
        }, retryDelay ?? options.pollInterval * 1000);
    };
    const removeProvider = async (status = "disconnected") => {
        const hadRegistration = (snapshot.ready && snapshot.connection !== undefined) || reloadPending;
        snapshot.ready = false;
        snapshot.connection = undefined;
        snapshot.apiBaseURL = undefined;
        snapshot.models = [];
        snapshot.registrationView = undefined;
        snapshot.audit = { status };
        snapshot.diagnostics = {
            cache: createDiscoveryCacheDiagnostics({ source: "none" }),
            note: status === "disconnected" ? "LiteLLM 尚未连接。" : undefined,
        };
        if (identity)
            coordinator.clear(identity);
        identity = undefined;
        lastFingerprint = undefined;
        persistedIdentity = undefined;
        persistedSnapshot = undefined;
        if (hadRegistration)
            await reload();
    };
    const clearModels = async (connection, apiBaseURL, status) => {
        const emptyFingerprint = fingerprint([]);
        const changed = !snapshot.ready || lastFingerprint !== emptyFingerprint || reloadPending;
        const view = createRegistrationView([], apiBaseURL, endpoint);
        snapshot.ready = true;
        snapshot.connection = connection;
        snapshot.apiBaseURL = apiBaseURL;
        snapshot.models = [];
        snapshot.registrationView = view;
        snapshot.audit = { status };
        snapshot.diagnostics = {
            cache: createDiscoveryCacheDiagnostics({ source: "none" }),
            note: status === "cleared-auth"
                ? "LiteLLM 返回认证失败；请检查当前凭据权限。"
                : "LiteLLM model/info 端点不可用。",
        };
        if (changed)
            await reload();
        lastFingerprint = emptyFingerprint;
    };
    const refreshOnce = async (forceRefresh) => {
        const connection = await context.integration.connection.active(endpoint.integrationId);
        if (!connection) {
            cancelTimer();
            await removeProvider();
            return;
        }
        const previous = snapshot.connection;
        const differentConnection = previous && (previous.type !== connection.type ||
            (previous.type === "credential" ? previous.id : previous.name) !==
                (connection.type === "credential" ? connection.id : connection.name));
        if (differentConnection) {
            const hadRegistration = snapshot.ready;
            snapshot.ready = false;
            snapshot.connection = connection;
            snapshot.apiBaseURL = undefined;
            snapshot.models = [];
            snapshot.registrationView = undefined;
            snapshot.audit = { status: "switching" };
            snapshot.diagnostics = {
                cache: createDiscoveryCacheDiagnostics({ source: "none", pending: true }),
                note: "连接已切换，等待新 endpoint 完成发现。",
            };
            lastFingerprint = undefined;
            persistedIdentity = undefined;
            persistedSnapshot = undefined;
            if (hadRegistration)
                await reload();
        }
        else if (!snapshot.ready && snapshot.audit?.status === "disconnected") {
            snapshot.audit = { status: "pending" };
            snapshot.diagnostics = {
                cache: createDiscoveryCacheDiagnostics({ source: "none", pending: true }),
                note: "等待首次网络发现。",
            };
        }
        const resolved = await context.integration.connection.resolve(connection);
        if (!isKeyCredential(resolved)) {
            logger.error("LiteLLM 活动连接没有可用的 API Key");
            await removeProvider();
            return;
        }
        const rawURL = endpoint.fixedBaseUrl ?? resolved.configuration?.url;
        if (typeof rawURL !== "string" || rawURL.length === 0) {
            logger.error(`LiteLLM endpoint ${endpoint.id} 缺少必填地址`);
            await removeProvider();
            return;
        }
        let addresses;
        try {
            addresses = normalizeLiteLLMURL(rawURL);
        }
        catch (error) {
            logger.error(error instanceof Error ? error.message : "LiteLLM 地址无效");
            await removeProvider();
            return;
        }
        const nextIdentity = connectionIdentity(connection, resolved, addresses.rootURL);
        const connectionChanged = identity !== undefined && identity !== nextIdentity;
        if (connectionChanged) {
            if (identity)
                coordinator.clear(identity);
            const hadRegistration = snapshot.ready;
            snapshot.ready = false;
            snapshot.connection = connection;
            snapshot.apiBaseURL = addresses.apiBaseURL;
            snapshot.models = [];
            snapshot.registrationView = undefined;
            snapshot.audit = { status: "switching" };
            snapshot.diagnostics = {
                cache: createDiscoveryCacheDiagnostics({ source: "none", pending: true }),
                note: "endpoint 或凭据已变化，等待新结果。",
            };
            lastFingerprint = undefined;
            if (hadRegistration)
                await reload();
        }
        identity = nextIdentity;
        const expectedEndpoint = endpointFingerprint({
            endpointID: endpoint.legacy ? undefined : endpoint.id,
            baseUrl: addresses.rootURL,
            credentialKey: resolved.key,
            buildOptions: {
                contextTierCap: options.contextTierCap,
                protocolOverrides: options.protocolOverrides,
            },
        });
        const previousPersisted = await loadPersistedSnapshot(nextIdentity, expectedEndpoint);
        if (!snapshot.ready && previousPersisted) {
            const restoredModels = previousPersisted.models.map(toOpenCodeModelSpec);
            const restoredView = createRegistrationView(restoredModels, addresses.apiBaseURL, endpoint);
            snapshot.ready = true;
            snapshot.connection = connection;
            snapshot.apiBaseURL = addresses.apiBaseURL;
            snapshot.models = restoredModels;
            snapshot.registrationView = restoredView;
            lastFingerprint = fingerprint(restoredModels);
            snapshot.audit = {
                status: "stale",
                lastSuccessfulDiscoveryAt: previousPersisted.discoveredAt,
                view: restoredView,
            };
            snapshot.diagnostics = {
                cache: createDiscoveryCacheDiagnostics({
                    source: "snapshot",
                    refreshedAt: Date.parse(previousPersisted.discoveredAt),
                }),
                note: "当前结果来自 endpoint-compatible 持久化快照，等待网络确认。",
            };
            await reload();
        }
        try {
            const coordinated = await coordinator.refresh(nextIdentity, async () => {
                const response = await fetchModelInfo(addresses, resolved.key, dependencies.fetchImpl);
                const catalog = await fetchCatalog({
                    fetchImpl: dependencies.fetchImpl,
                    logger,
                });
                if (dependencies.buildModels) {
                    const models = buildModels(response, catalog, options);
                    return { models, fingerprint: fingerprint(models) };
                }
                const diagnosed = diagnoseModelSpecs(response, catalog, options);
                const models = diagnosed.models.map(toOpenCodeModelSpec);
                return {
                    models,
                    fingerprint: fingerprint(models),
                    diagnostics: diagnosed.diagnostics,
                };
            }, {
                forceRefresh,
                failurePolicy: (error) => error instanceof DiscoveryError && (error.kind === "auth" || error.kind === "notfound")
                    ? "clear"
                    : "stale",
            });
            if (disposed || identity !== nextIdentity)
                return;
            if (coordinated.source === "stale") {
                const message = coordinated.error instanceof Error ? coordinated.error.message : String(coordinated.error);
                logger.warn(`LiteLLM 发现失败，使用 last-known-good：${redact(message, resolved.key)}`);
                if (snapshot.audit?.view)
                    snapshot.audit = { ...snapshot.audit, status: "stale" };
                snapshot.diagnostics = {
                    discovery: coordinated.value.diagnostics ?? snapshot.diagnostics?.discovery,
                    cache: createDiscoveryCacheDiagnostics({
                        source: "stale",
                        stale: true,
                        refreshedAt: coordinated.refreshedAt,
                        failureCount: coordinated.failureCount,
                        nextRetryAt: coordinated.nextRetryAt,
                    }),
                    note: "刷新失败，保留上次成功结果。",
                };
                return;
            }
            const { models, fingerprint: nextFingerprint } = coordinated.value;
            const nextPersisted = createDiscoverySnapshot(expectedEndpoint, neutralModels(models), new Date(coordinated.refreshedAt).toISOString());
            if (previousPersisted) {
                const diff = compareDiscoverySnapshots(previousPersisted, nextPersisted);
                if (diff.drift) {
                    logger.warn(`LiteLLM 发现漂移：added=${diff.added.length}, removed=${diff.removed.length}, protocol=${diff.protocolChanged.length}, capabilities=${diff.capabilityChanged.length}`);
                }
            }
            const changed = !snapshot.ready || lastFingerprint !== nextFingerprint || reloadPending;
            const view = changed || !snapshot.registrationView
                ? createRegistrationView(models, addresses.apiBaseURL, endpoint)
                : snapshot.registrationView;
            snapshot.ready = true;
            snapshot.connection = connection;
            snapshot.apiBaseURL = addresses.apiBaseURL;
            snapshot.models = models;
            snapshot.registrationView = view;
            if (changed)
                await reload();
            lastFingerprint = nextFingerprint;
            await persistSnapshot(nextIdentity, nextPersisted);
            snapshot.audit = {
                status: models.length === 0 ? "empty" : "ready",
                lastSuccessfulDiscoveryAt: new Date(coordinated.refreshedAt).toISOString(),
                view,
            };
            snapshot.diagnostics = {
                discovery: coordinated.value.diagnostics,
                cache: createDiscoveryCacheDiagnostics({
                    source: coordinated.source === "cache" ? "memory-cache" : "network",
                    stale: false,
                    refreshedAt: coordinated.refreshedAt,
                    failureCount: coordinated.failureCount,
                    nextRetryAt: coordinated.nextRetryAt,
                }),
            };
        }
        catch (error) {
            if (disposed || identity !== nextIdentity)
                return;
            if (error instanceof DiscoveryError && (error.kind === "auth" || error.kind === "notfound")) {
                logger.error(redact(error.message, resolved.key));
                await clearPersistedSnapshot(nextIdentity);
                await clearModels(connection, addresses.apiBaseURL, error.kind === "auth" ? "cleared-auth" : "cleared-notfound");
            }
            else {
                const message = error instanceof Error ? error.message : String(error);
                logger.warn(`LiteLLM 发现失败，保留上次结果：${redact(message, resolved.key)}`);
                if (snapshot.audit?.view)
                    snapshot.audit = { ...snapshot.audit, status: "stale" };
                const state = coordinator.state(nextIdentity);
                snapshot.diagnostics = {
                    discovery: snapshot.diagnostics?.discovery,
                    cache: createDiscoveryCacheDiagnostics({
                        source: state.hasValue ? "stale" : "none",
                        stale: state.hasValue,
                        refreshedAt: state.refreshedAt,
                        failureCount: state.failureCount,
                        nextRetryAt: state.nextRetryAt,
                        pending: state.pending,
                    }),
                    note: "发现失败；详细错误已通过宿主日志记录。",
                };
            }
        }
        finally {
            schedule();
        }
    };
    let queuedForce = false;
    const trigger = (forceRefresh = true) => {
        if (disposed)
            return Promise.resolve();
        if (running) {
            queued = true;
            queuedForce ||= forceRefresh;
            return running;
        }
        running = (async () => {
            let nextForce = forceRefresh;
            do {
                queued = false;
                queuedForce = false;
                try {
                    await refreshOnce(nextForce);
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    logger.warn(`LiteLLM 发现循环出错，将在下个周期重试：${redact(message)}`);
                    schedule();
                }
                nextForce = queuedForce;
            } while (queued && !disposed);
        })().finally(() => {
            running = undefined;
        });
        return running;
    };
    const listen = async () => {
        try {
            for await (const event of context.event.subscribe({ signal: abortEvents.signal })) {
                if (disposed)
                    break;
                if (switchedForLiteLLM(event, endpoint.integrationId)) {
                    cancelTimer();
                    void trigger(true);
                }
            }
        }
        catch (error) {
            if (!disposed) {
                const message = error instanceof Error ? error.message : String(error);
                logger.warn(`LiteLLM 连接事件订阅已停止，将依靠轮询：${redact(message)}`);
            }
        }
    };
    return {
        async start() {
            if (disposed)
                return;
            eventTask = listen();
            await trigger(true);
        },
        trigger,
        async dispose() {
            if (disposed)
                return;
            disposed = true;
            cancelTimer();
            abortEvents.abort();
            await running;
            void eventTask;
        },
    };
}
