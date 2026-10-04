import { Plugin } from "@opencode/plugin";
import { registerAudit } from "./host/audit-command.js";
import { registerEndpointActivation } from "./host/endpoint-command.js";
import { createEndpointManagement } from "./host/endpoint-manager.js";
import { registerMultiEndpointAudit } from "./host/multi-audit-command.js";
import { registerIntegration, registerIntegrations, registerProvider } from "./host/register.js";
import { formatStartupIdentityLine, getRuntimeIdentity } from "./host/runtime-identity.js";
import { createDiscoveryLoop } from "./host/sync.js";
import { ACTIVATION_STORAGE_KEY, activeEndpointIds, endpointIdentity, parseActivation, } from "./endpoints.js";
import { parseOptions } from "./options.js";
export const PLUGIN_ID = "litellm";
async function setupEndpoint(context, endpoint, options, dependencies, snapshots, snapshotOverride, registerEndpointIntegration = true, desired = "enabled", triggers) {
    const snapshot = snapshotOverride ?? { ready: false, models: [], audit: { status: "disconnected" } };
    snapshot.endpointState = {
        endpointId: endpoint.id,
        desired,
        validation: endpoint.validation,
        credential: "unknown",
        applied: { kind: "not-applied" },
    };
    snapshots?.set(endpoint.id, snapshot);
    const endpointOptions = {
        ...options,
        endpoints: undefined,
        protocolOverrides: options.endpoints?.[endpoint.id]?.protocolOverrides ?? options.protocolOverrides,
    };
    const integrationRegistration = registerEndpointIntegration
        ? await registerIntegration(context, endpoint)
        : undefined;
    const providerRegistration = await registerProvider(context, snapshot, endpoint);
    const loop = createDiscoveryLoop(context, snapshot, endpointOptions, dependencies, endpoint);
    const startup = loop.start();
    triggers?.set(endpoint.id, async () => { await loop.trigger(true); });
    return async () => {
        await loop.dispose();
        await startup;
        triggers?.delete(endpoint.id);
        // Canonical: leaving the active set means the endpoint is no longer applied,
        // regardless of why (deactivate, reconcile, dispose). Persisted activation is
        // owned by the management layer; we never rewrite it here.
        snapshot.endpointState = snapshot.endpointState
            ? { ...snapshot.endpointState, applied: { kind: "not-applied" } }
            : snapshot.endpointState;
        snapshots?.delete(endpoint.id);
        await providerRegistration.dispose();
        await integrationRegistration?.dispose();
    };
}
async function readActivation(context) {
    if (!context.storage)
        return { mode: "all" };
    try {
        const raw = await context.storage.get(ACTIVATION_STORAGE_KEY);
        return parseActivation(typeof raw === "string" ? JSON.parse(raw) : raw);
    }
    catch {
        return { mode: "all" };
    }
}
async function writeActivation(context, value) {
    if (!context.storage)
        return;
    await context.storage.set(ACTIVATION_STORAGE_KEY, JSON.stringify(value));
}
async function buildLegacy(context, options, dependencies, activation) {
    // Legacy mode keeps the old integration/credential/snapshot namespaces, while the
    // new global activation state defaults to "all" so existing users migrate with no action.
    const endpoint = endpointIdentity("default", undefined, true);
    const snapshot = { ready: false, models: [], audit: { status: "disconnected" } };
    snapshot.endpointState = {
        endpointId: "default",
        desired: "disabled",
        validation: endpoint.validation,
        credential: "unknown",
        applied: { kind: "not-applied" },
    };
    const snapshots = new Map([["default", snapshot]]);
    const triggers = new Map();
    let endpointDispose;
    // The integration is registered regardless of activation: an inactive endpoint must still accept
    // Connect / Replace / Disconnect (and /connect must stay reachable) — activation gates only the
    // provider/discovery lifecycle. This matches the explicit multi-endpoint mode.
    const integrationRegistration = await registerIntegration(context, endpoint);
    const reconcile = async () => {
        const active = activeEndpointIds(["default"], activation()).includes("default");
        if (active && !endpointDispose) {
            snapshot.endpointState = snapshot.endpointState
                ? { ...snapshot.endpointState, desired: "enabled" }
                : snapshot.endpointState;
            endpointDispose = await setupEndpoint(context, endpoint, options, dependencies, snapshots, snapshot, false, "enabled", triggers);
        }
        else if (!active && endpointDispose) {
            const dispose = endpointDispose;
            endpointDispose = undefined;
            await dispose();
            snapshot.ready = false;
            snapshot.connection = undefined;
            snapshot.apiBaseURL = undefined;
            snapshot.models = [];
            snapshot.registrationView = undefined;
            snapshot.audit = { status: "disconnected" };
            snapshot.endpointState = {
                endpointId: "default",
                desired: "disabled",
                validation: endpoint.validation,
                credential: snapshot.endpointState?.credential ?? "unknown",
                applied: { kind: "not-applied" },
            };
        }
    };
    await reconcile();
    const auditRegistration = await registerAudit(context, snapshot, {
        conversationFeedback: options.conversationFeedback,
    });
    return {
        ids: ["default"],
        reconcile,
        snapshots,
        async triggerEndpoint(endpointId) {
            if (endpointId !== "default")
                return { ok: false, message: `未知 endpoint：${endpointId}` };
            const trigger = triggers.get(endpointId);
            if (!trigger)
                return { ok: false, message: "endpoint 未激活或不可用" };
            try {
                await trigger();
                return { ok: true };
            }
            catch (error) {
                return { ok: false, message: error instanceof Error ? error.message : String(error) };
            }
        },
        async dispose() {
            await auditRegistration.dispose();
            await endpointDispose?.();
            await integrationRegistration.dispose();
        },
    };
}
async function buildExplicit(context, options, dependencies, activation) {
    const endpointIds = Object.keys(options.endpoints ?? {});
    const identities = new Map(endpointIds.map((id) => {
        const definition = options.endpoints?.[id];
        return [id, endpointIdentity(id, definition?.baseUrl, false, definition?.validation ?? { kind: "ok" })];
    }));
    const snapshots = new Map();
    const disposers = new Map();
    const triggers = new Map();
    // OpenCode V2 does not support runtime child-plugin mutation. Keep every
    // configured integration registered in this plugin instance so /connect can
    // manage an independent credential for each endpoint, while activation only
    // starts/stops provider discovery and publication. Invalid endpoints are
    // included so /litellm-endpoints and /litellm-diagnostics can show them;
    // they never reach the discovery loop (activateOne places a placeholder instead).
    const integrationRegistration = await registerIntegrations(context, [...identities.values()]);
    const activateOne = async (id) => {
        if (disposers.has(id))
            return;
        const endpoint = identities.get(id);
        if (!endpoint)
            return;
        const definition = options.endpoints?.[id];
        const validation = definition?.validation ?? { kind: "ok" };
        // Invalid endpoint: keep a canonical snapshot so management/diagnostics can
        // show "Invalid configuration"; never register it with the host runtime.
        if (validation.kind === "invalid") {
            const snapshot = { ready: false, models: [], audit: { status: "disconnected" } };
            snapshot.endpointState = {
                endpointId: id,
                desired: "enabled",
                validation,
                credential: "unknown",
                applied: { kind: "error", category: "config-invalid", message: validation.reason },
            };
            snapshots.set(id, snapshot);
            return;
        }
        const snapshot = snapshots.get(id) ?? { ready: false, models: [], audit: { status: "disconnected" } };
        snapshot.endpointState = {
            endpointId: id,
            desired: "enabled",
            validation: { kind: "ok" },
            credential: snapshot.endpointState?.credential ?? "unknown",
            applied: snapshot.endpointState?.applied ?? { kind: "not-applied" },
        };
        snapshots.set(id, snapshot);
        disposers.set(id, await setupEndpoint(context, endpoint, options, dependencies, snapshots, snapshot, false, "enabled", triggers));
    };
    const deactivateOne = async (id) => {
        const dispose = disposers.get(id);
        if (dispose) {
            disposers.delete(id);
            await dispose();
        }
        // Keep the canonical snapshot around with desired=disabled so management and
        // diagnostics still see the endpoint even when it is no longer registered.
        const existing = snapshots.get(id);
        if (existing) {
            existing.endpointState = {
                ...(existing.endpointState ?? {
                    endpointId: id,
                    validation: options.endpoints?.[id]?.validation ?? { kind: "ok" },
                    credential: "unknown",
                    applied: { kind: "not-applied" },
                }),
                desired: "disabled",
                applied: { kind: "not-applied" },
            };
        }
        else {
            const snapshot = { ready: false, models: [], audit: { status: "disconnected" } };
            snapshot.endpointState = {
                endpointId: id,
                desired: "disabled",
                validation: options.endpoints?.[id]?.validation ?? { kind: "ok" },
                credential: "unknown",
                applied: { kind: "not-applied" },
            };
            snapshots.set(id, snapshot);
        }
    };
    const reconcile = async () => {
        const active = new Set(activeEndpointIds(endpointIds, activation()));
        // Ensure every configured endpoint has a snapshot — including ones that are
        // currently inactive: diagnostics and management must be able to show them.
        for (const id of endpointIds) {
            if (snapshots.has(id) || active.has(id))
                continue;
            const definition = options.endpoints?.[id];
            const snapshot = { ready: false, models: [], audit: { status: "disconnected" } };
            snapshot.endpointState = {
                endpointId: id,
                desired: "disabled",
                validation: definition?.validation ?? { kind: "ok" },
                credential: "unknown",
                applied: { kind: "not-applied" },
            };
            snapshots.set(id, snapshot);
        }
        for (const id of [...disposers.keys()])
            if (!active.has(id))
                await deactivateOne(id);
        for (const id of endpointIds)
            if (active.has(id))
                await activateOne(id);
    };
    try {
        await reconcile();
    }
    catch (error) {
        for (const id of [...disposers.keys()])
            await deactivateOne(id);
        await integrationRegistration.dispose();
        throw error;
    }
    const auditRegistration = await registerMultiEndpointAudit(context, endpointIds, () => activeEndpointIds(endpointIds, activation()), snapshots);
    return {
        ids: endpointIds,
        reconcile,
        snapshots,
        async triggerEndpoint(endpointId) {
            if (!endpointIds.includes(endpointId))
                return { ok: false, message: `未知 endpoint：${endpointId}` };
            const trigger = triggers.get(endpointId);
            if (!trigger)
                return { ok: false, message: "endpoint 未激活或不可用" };
            try {
                await trigger();
                return { ok: true };
            }
            catch (error) {
                return { ok: false, message: error instanceof Error ? error.message : String(error) };
            }
        },
        async dispose() {
            await auditRegistration.dispose();
            for (const id of [...disposers.keys()])
                await deactivateOne(id);
            await integrationRegistration.dispose();
        },
    };
}
const buildRuntime = (context, options, dependencies, activation) => options.endpoints === undefined
    ? buildLegacy(context, options, dependencies, activation)
    : buildExplicit(context, options, dependencies, activation);
async function pluginSourceTarget(context) {
    try {
        const list = await context.plugin?.list?.();
        const items = Array.isArray(list) ? list : list?.data;
        for (const item of items ?? []) {
            const entry = item;
            if (entry.id !== PLUGIN_ID)
                continue;
            return entry.source?.type === "package" ? entry.source.target : entry.source?.type === "local" ? entry.source.path : undefined;
        }
    }
    catch {
        // The host may not expose plugin.list() to this context; fall back to name matching.
    }
    return undefined;
}
export async function setupLiteLLM(rawContext, dependencies = {}, internals = {}) {
    const context = rawContext;
    try {
        const startupLogger = internals.logger ?? console;
        const line = formatStartupIdentityLine(getRuntimeIdentity());
        if (typeof startupLogger.info === "function")
            startupLogger.info(line);
        else
            startupLogger.log(line);
    }
    catch {
        // Startup identity logging must never block plugin setup.
    }
    let options = parseOptions(context.options);
    let activation = await readActivation(context);
    let runtime = await buildRuntime(context, options, dependencies, () => activation);
    const management = createEndpointManagement({
        env: process.env,
        options: () => options,
        ids: () => runtime.ids,
        activation: () => activation,
        async setActivation(next) {
            activation = next;
            await writeActivation(context, next);
            await runtime.reconcile();
        },
        async rebuild(next) {
            const previous = options;
            await runtime.dispose();
            options = next;
            try {
                runtime = await buildRuntime(context, next, dependencies, () => activation);
            }
            catch (error) {
                // Roll back to the last working configuration rather than leaving no runtime at all.
                options = previous;
                runtime = await buildRuntime(context, previous, dependencies, () => activation);
                throw error;
            }
        },
        async legacyBaseUrl() {
            const connection = await context.integration.connection.active("litellm");
            if (!connection)
                return undefined;
            const resolved = await context.integration.connection.resolve(connection);
            const url = resolved?.type === "key" ? resolved.configuration?.url : undefined;
            return typeof url === "string" && url.length > 0 ? url : undefined;
        },
        async removeStorage(key) {
            if (!context.storage)
                return;
            const storage = context.storage;
            if (storage.remove)
                await storage.remove(key);
            else
                await storage.set(key, "null");
        },
        sourceTarget: () => pluginSourceTarget(context),
        snapshots: () => runtime.snapshots,
        triggerEndpoint: (id) => runtime.triggerEndpoint(id),
        ...internals.management,
    });
    const activationRegistration = await registerEndpointActivation(context, () => runtime.ids, () => activation, async (next) => {
        activation = next;
        await writeActivation(context, next);
        await runtime.reconcile();
    }, management);
    return async () => {
        await activationRegistration.dispose();
        await runtime.dispose();
    };
}
export default Plugin.define({
    id: PLUGIN_ID,
    setup: setupLiteLLM,
});
