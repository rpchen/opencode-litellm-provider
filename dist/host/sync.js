import { buildModelSpecs, modelFingerprint } from "../core/build.js";
import { normalizeLiteLLMURL } from "../core/litellm.js";
import { DiscoveryError, fetchLiteLLMModelInfo, getModelsDevCatalog, redact, } from "../net/fetch.js";
import { createRegistrationView, INTEGRATION_ID } from "./register.js";
const defaultScheduler = {
    setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimeout: (handle) => clearTimeout(handle),
};
function isKeyCredential(value) {
    return typeof value === "object" && value !== null && value.type === "key" &&
        typeof value.key === "string";
}
function switchedForLiteLLM(event) {
    if (event.type === "credential.updated")
        return true;
    if (event.type !== "credential.switched" || typeof event.data !== "object" || event.data === null)
        return false;
    return event.data.integrationID === INTEGRATION_ID;
}
function connectionIdentity(connection, credential, url) {
    const connectionID = connection.type === "credential" ? connection.id : connection.name;
    return `${connection.type}\u0000${connectionID}\u0000${url}\u0000${credential.key}`;
}
export function createDiscoveryLoop(context, snapshot, options, dependencies = {}) {
    const scheduler = dependencies.scheduler ?? defaultScheduler;
    const logger = dependencies.logger ?? console;
    const fetchModelInfo = dependencies.fetchLiteLLM ?? fetchLiteLLMModelInfo;
    const fetchCatalog = dependencies.getModelsDev ?? getModelsDevCatalog;
    const buildModels = dependencies.buildModels ?? buildModelSpecs;
    const fingerprint = dependencies.fingerprint ?? modelFingerprint;
    const abortEvents = new AbortController();
    snapshot.audit ??= { status: "disconnected" };
    let timer;
    let disposed = false;
    let running;
    let queued = false;
    let identity;
    let lastFingerprint;
    let reloadPending = false;
    let eventTask;
    const reload = async () => {
        reloadPending = true;
        await context.provider.reload();
        reloadPending = false;
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
        timer = scheduler.setTimeout(() => {
            timer = undefined;
            void trigger();
        }, options.pollInterval * 1000);
    };
    const removeProvider = async (status = "disconnected") => {
        const hadRegistration = (snapshot.ready && snapshot.connection !== undefined) || reloadPending;
        snapshot.ready = false;
        snapshot.connection = undefined;
        snapshot.apiBaseURL = undefined;
        snapshot.models = [];
        snapshot.registrationView = undefined;
        snapshot.audit = { status };
        identity = undefined;
        lastFingerprint = undefined;
        if (hadRegistration)
            await reload();
    };
    const clearModels = async (connection, apiBaseURL, status) => {
        const emptyFingerprint = fingerprint([]);
        const changed = !snapshot.ready || lastFingerprint !== emptyFingerprint || reloadPending;
        const view = createRegistrationView([], apiBaseURL);
        snapshot.ready = true;
        snapshot.connection = connection;
        snapshot.apiBaseURL = apiBaseURL;
        snapshot.models = [];
        snapshot.registrationView = view;
        snapshot.audit = { status };
        if (changed)
            await reload();
        lastFingerprint = emptyFingerprint;
    };
    const refreshOnce = async () => {
        const connection = await context.integration.connection.active(INTEGRATION_ID);
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
            lastFingerprint = undefined;
            if (hadRegistration)
                await reload();
        }
        else if (!snapshot.ready && snapshot.audit?.status === "disconnected") {
            snapshot.audit = { status: "pending" };
        }
        const resolved = await context.integration.connection.resolve(connection);
        if (!isKeyCredential(resolved)) {
            logger.error("LiteLLM 活动连接没有可用的 API Key");
            await removeProvider();
            return;
        }
        const rawURL = resolved.configuration?.url;
        if (typeof rawURL !== "string" || rawURL.length === 0) {
            logger.error("LiteLLM 活动连接缺少必填地址");
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
            const hadRegistration = snapshot.ready;
            snapshot.ready = false;
            snapshot.connection = connection;
            snapshot.apiBaseURL = addresses.apiBaseURL;
            snapshot.models = [];
            snapshot.registrationView = undefined;
            snapshot.audit = { status: "switching" };
            lastFingerprint = undefined;
            if (hadRegistration)
                await reload();
        }
        identity = nextIdentity;
        try {
            const response = await fetchModelInfo(addresses, resolved.key, dependencies.fetchImpl);
            const catalog = await fetchCatalog({
                fetchImpl: dependencies.fetchImpl,
                logger,
            });
            if (disposed || identity !== nextIdentity)
                return;
            const models = buildModels(response, catalog, options);
            const nextFingerprint = fingerprint(models);
            const changed = !snapshot.ready || lastFingerprint !== nextFingerprint || reloadPending;
            const view = changed || !snapshot.registrationView
                ? createRegistrationView(models, addresses.apiBaseURL)
                : snapshot.registrationView;
            snapshot.ready = true;
            snapshot.connection = connection;
            snapshot.apiBaseURL = addresses.apiBaseURL;
            snapshot.models = models;
            snapshot.registrationView = view;
            if (changed)
                await reload();
            lastFingerprint = nextFingerprint;
            snapshot.audit = {
                status: models.length === 0 ? "empty" : "ready",
                lastSuccessfulDiscoveryAt: new Date().toISOString(),
                view,
            };
        }
        catch (error) {
            if (disposed || identity !== nextIdentity)
                return;
            if (error instanceof DiscoveryError && (error.kind === "auth" || error.kind === "notfound")) {
                logger.error(redact(error.message, resolved.key));
                await clearModels(connection, addresses.apiBaseURL, error.kind === "auth" ? "cleared-auth" : "cleared-notfound");
            }
            else {
                const message = error instanceof Error ? error.message : String(error);
                logger.warn(`LiteLLM 发现失败，保留上次结果：${redact(message, resolved.key)}`);
                if (snapshot.audit?.view)
                    snapshot.audit = { ...snapshot.audit, status: "stale" };
            }
        }
        finally {
            schedule();
        }
    };
    const trigger = () => {
        if (disposed)
            return Promise.resolve();
        if (running) {
            queued = true;
            return running;
        }
        running = (async () => {
            do {
                queued = false;
                try {
                    await refreshOnce();
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    logger.warn(`LiteLLM 发现循环出错，将在下个周期重试：${redact(message)}`);
                    schedule();
                }
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
                if (switchedForLiteLLM(event)) {
                    cancelTimer();
                    void trigger();
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
            await trigger();
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
