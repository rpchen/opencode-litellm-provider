import { activeEndpointIds } from "../endpoints.js";
import { parseOptions } from "../options.js";
import { ConfigFileError, locateConfig, mutateEndpoints, readPluginOptions, } from "./config-file.js";
import { discoverySnapshotKey } from "./sync.js";
const QUIET = { warn() { } };
const fail = (code, message) => ({ ok: false, code, message });
const messageOf = (error) => (error instanceof Error ? error.message : String(error));
export function createEndpointManagement(host) {
    let problem;
    let located = false;
    const normalize = (raw) => JSON.stringify(parseOptions(raw, QUIET));
    const locate = async () => {
        const target = host.target ?? locateConfig(host.env, await host.sourceTarget());
        located = target !== undefined;
        return target;
    };
    /** Read the canonical file, flag shadowed/unreadable configs, and sync the runtime to hand edits. */
    async function refresh() {
        problem = undefined;
        const target = await locate();
        if (!target) {
            problem = "找不到声明了 LiteLLM 插件的配置文件（OPENCODE_CONFIG 或全局 opencode.jsonc）；请在其中声明插件后再管理 endpoint";
            return;
        }
        let fileOptions;
        try {
            fileOptions = readPluginOptions(target, await host.sourceTarget());
        }
        catch (error) {
            problem = messageOf(error);
            return;
        }
        const running = JSON.stringify(host.options());
        const fromFile = normalize(fileOptions);
        if (running === fromFile)
            return;
        if (!synced) {
            problem = "当前生效的插件 options 与全局配置文件不一致（可能来自内联或项目配置），endpoint 管理为只读";
            return;
        }
        await host.rebuild(parseOptions(fileOptions, QUIET));
    }
    // Until the first successful comparison we do not know the file is what the host runs.
    let synced = false;
    const initial = async () => {
        if (synced)
            return;
        const target = await locate();
        if (!target)
            return;
        try {
            synced = normalize(readPluginOptions(target, await host.sourceTarget())) === JSON.stringify(host.options());
        }
        catch {
            synced = false;
        }
    };
    const writable = async () => {
        await initial();
        await refresh();
        return problem ? fail("readonly", problem) : undefined;
    };
    const currentEndpoints = () => {
        const options = host.options();
        const active = new Set(activeEndpointIds(host.ids(), host.activation()));
        if (options.endpoints === undefined)
            return [{ id: "default", baseUrl: "", active: active.has("default"), legacy: true }];
        return Object.entries(options.endpoints).map(([id, definition]) => ({
            id,
            baseUrl: definition.baseUrl,
            active: active.has(id),
            legacy: false,
        }));
    };
    const materializeActivation = async (exclude) => {
        const next = activeEndpointIds(host.ids(), host.activation()).filter((id) => id !== exclude);
        const current = host.activation();
        const same = current.mode === "selected" &&
            current.endpointIds.length === next.length && next.every((id) => current.endpointIds.includes(id));
        if (!same)
            await host.setActivation({ mode: "selected", endpointIds: next });
    };
    const write = async (target, mutation) => mutateEndpoints(target, mutation, { sourceTarget: await host.sourceTarget(), ...host.write });
    const afterWrite = async (target) => {
        await host.rebuild(parseOptions(readPluginOptions(target, await host.sourceTarget()), QUIET));
    };
    return {
        refresh: async () => { await initial(); await refresh(); },
        endpoints: currentEndpoints,
        writable: () => ({
            writable: problem === undefined && located,
            ...(problem ? { problem } : {}),
            legacyMigration: host.options().endpoints === undefined,
        }),
        async add(input) {
            const blocked = await writable();
            if (blocked)
                return blocked;
            const target = (await locate());
            try {
                const legacy = host.options().endpoints === undefined;
                const address = legacy ? await host.legacyBaseUrl() : undefined;
                // New endpoints start inactive: pin the current active set (without the new id) before writing.
                await materializeActivation(input.endpointId);
                const result = await write(target, {
                    kind: "add",
                    id: input.endpointId,
                    baseUrl: input.baseUrl,
                    ...(address ? { migrateLegacy: { baseUrl: address } } : {}),
                    confirmMigration: input.confirmMigration === true,
                });
                await afterWrite(target);
                if (result.migratedLegacy)
                    await host.removeStorage(discoverySnapshotKey("default", true)).catch(() => { });
                return { ok: true, migrated: result.migratedLegacy };
            }
            catch (error) {
                if (error instanceof ConfigFileError)
                    return fail(error.code, error.message);
                return fail("error", messageOf(error));
            }
        },
        async edit(input) {
            const blocked = await writable();
            if (blocked)
                return blocked;
            const target = (await locate());
            try {
                await write(target, { kind: "edit", id: input.endpointId, baseUrl: input.baseUrl });
                await afterWrite(target);
                return { ok: true };
            }
            catch (error) {
                if (error instanceof ConfigFileError)
                    return fail(error.code, error.message);
                return fail("error", messageOf(error));
            }
        },
        async prepareRemove(input) {
            const blocked = await writable();
            if (blocked)
                return blocked;
            if (host.options().endpoints === undefined) {
                return fail("legacy-default", "默认 endpoint 来自单 endpoint 连接配置，不能在这里删除；请用 /connect 管理其凭据");
            }
            if (!currentEndpoints().some((entry) => entry.id === input.endpointId))
                return fail("not-found", `Endpoint ${input.endpointId} 不存在`);
            try {
                // Stop the endpoint (loop, provider, discovery) and drop its persisted snapshot; definition stays.
                await materializeActivation(input.endpointId);
                await host.removeStorage(discoverySnapshotKey(input.endpointId, false));
                return { ok: true };
            }
            catch (error) {
                return fail("error", messageOf(error));
            }
        },
        async remove(input) {
            const blocked = await writable();
            if (blocked)
                return blocked;
            const target = (await locate());
            try {
                await write(target, { kind: "delete", id: input.endpointId });
                await afterWrite(target);
                await materializeActivation(input.endpointId);
                await host.removeStorage(discoverySnapshotKey(input.endpointId, false)).catch(() => { });
                return { ok: true };
            }
            catch (error) {
                if (error instanceof ConfigFileError)
                    return fail(error.code, error.message);
                return fail("error", messageOf(error));
            }
        },
    };
}
