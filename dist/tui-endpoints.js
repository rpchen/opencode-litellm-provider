/**
 * TUI side of `/litellm-endpoints`: the management center built on the host's native dialogs
 * (`dialog.select / prompt / confirm`). Endpoint CRUD goes through the plugin's RPC; credentials go
 * through the host's own client API so API keys never pass through the plugin. See design.md.
 *
 * User-visible status labels come from the canonical endpoint state shared with the
 * server side; TUI never derives its own truth.
 */
import { validateApiKey, validateBaseUrl, validateEndpointId } from "./endpoint-input.js";
export const integrationIdFor = (endpointId) => (endpointId === "default" ? "litellm" : `litellm-${endpointId}`);
const unwrap = (value) => {
    if (typeof value === "object" && value !== null && "data" in value && !("connections" in value))
        return value.data;
    return value;
};
export async function connectionsOf(client, endpointId) {
    const info = unwrap(await client.integration.get({ integrationID: integrationIdFor(endpointId) }));
    return Array.isArray(info?.connections) ? info.connections : [];
}
const credentialIds = (connections) => connections.filter((connection) => connection.type === "credential" && typeof connection.id === "string").map((connection) => connection.id);
export async function credentialKind(client, endpointId) {
    try {
        const connections = await connectionsOf(client, endpointId);
        if (credentialIds(connections).length > 0)
            return "stored";
        return connections.some((connection) => connection.type === "env") ? "environment" : "none";
    }
    catch {
        return "none";
    }
}
/** Does this integration's key auth method carry a `url` form field (legacy integrations do)? */
export async function keyMethodRequiresUrl(client, endpointId) {
    try {
        const info = unwrap(await client.integration.get({ integrationID: integrationIdFor(endpointId) }));
        const keyMethod = info?.methods?.find((method) => method.type === "key");
        return Array.isArray(keyMethod?.form) && keyMethod.form.some((field) => field?.key === "url");
    }
    catch {
        return false;
    }
}
/**
 * Connect (or replace) an endpoint's key through the host credential store. The key is never returned.
 *
 * OpenCode validates the key method's form before authenticating: a legacy integration requires the
 * `url` answer, so omitting it makes the host reject the credential (no key is saved for the endpoint).
 */
export async function saveKey(client, endpointId, key, url) {
    const integrationID = integrationIdFor(endpointId);
    const before = credentialIds(await connectionsOf(client, endpointId));
    const needsUrl = await keyMethodRequiresUrl(client, endpointId);
    if (needsUrl && !url) {
        throw new Error("该 endpoint 的认证表单还需要 LiteLLM 地址（url）；请先迁移为可管理配置后再连接");
    }
    await client.integration.connect.key({ integrationID, key, ...(needsUrl && url ? { answer: { url } } : {}) });
    const after = credentialIds(await connectionsOf(client, endpointId));
    const added = after.filter((id) => !before.includes(id));
    const newest = added.at(-1);
    if (newest)
        await client.credential.activate({ credentialID: newest });
    // Replace = overwrite: remove the credentials that existed before this key was entered.
    for (const id of before)
        await client.credential.remove({ credentialID: id });
}
/** Disconnect removes only this endpoint's stored credentials (env connections are not ours to remove). */
export async function removeKeys(client, endpointId) {
    for (const id of credentialIds(await connectionsOf(client, endpointId)))
        await client.credential.remove({ credentialID: id });
}
const CRED_LABEL = {
    stored: "已保存 API Key",
    environment: "API Key 来自环境变量",
    none: "未保存 API Key",
};
const messageOf = (error) => (error instanceof Error ? error.message : String(error));
export function createEndpointUi(deps) {
    const { dialog, toast, rpc, client } = deps;
    const info = (message) => toast.show({ variant: "success", message });
    const warn = (message) => toast.show({ variant: "warning", message });
    const error = (message) => toast.show({ variant: "error", message });
    const loadState = async () => unwrap(await rpc.state({}));
    const itemsOf = (state) => state.endpoints ?? state.endpointIds.map((id) => ({ id, baseUrl: "", active: state.activeEndpointIds.includes(id), legacy: id === "default" }));
    const activeList = (state) => itemsOf(state)
        .filter((item) => item.state ? item.state.desired === "enabled" : item.active)
        .map((item) => item.id);
    const setActive = async (id) => unwrap(await rpc.set({ action: "toggle", endpointId: id }));
    const promptBaseUrl = async (title, placeholder, value) => {
        let heading = title;
        for (;;) {
            const raw = await dialog.prompt({ title: heading, placeholder, ...(value !== undefined ? { value } : {}) });
            if (raw === undefined)
                return undefined;
            const check = validateBaseUrl(raw);
            if (check.ok)
                return check.value;
            heading = `${title}（输入无效：${check.message}）`;
        }
    };
    const addEndpoint = async (state) => {
        const existing = new Set(itemsOf(state).map((item) => item.id));
        let heading = "新增 endpoint：Endpoint ID";
        let id;
        for (;;) {
            const raw = await dialog.prompt({ title: heading, placeholder: "company" });
            if (raw === undefined)
                return;
            const candidate = raw.trim();
            const invalid = validateEndpointId(candidate);
            if (invalid)
                heading = `新增 endpoint：Endpoint ID（输入无效：${invalid}）`;
            else if (existing.has(candidate))
                heading = `新增 endpoint：Endpoint ID（${candidate} 已存在，请换一个）`;
            else {
                id = candidate;
                break;
            }
        }
        const baseUrl = await promptBaseUrl(`新增 endpoint ${id}：Base URL`, "http://litellm.example:4000");
        if (baseUrl === undefined)
            return;
        let confirmMigration = false;
        if (state.legacyMigration && itemsOf(state).some((item) => item.legacy)) {
            const ok = await dialog.confirm({
                title: "迁移为多 endpoint 配置",
                message: "当前使用单 endpoint（/connect 时填写地址）配置。新增第二个 endpoint 需要把现有地址迁移到 options.endpoints.default；" +
                    "integration id、已保存的凭据保持不变，发现缓存会重新生成。是否继续？",
            });
            if (!ok)
                return;
            confirmMigration = true;
        }
        const result = unwrap(await rpc.add({ endpointId: id, baseUrl, confirmMigration }));
        if (!result.ok) {
            // saved = the config write is committed but the runtime reload failed: not a plain "Add failed".
            if (result.saved)
                return warn(result.message ?? "endpoint 配置已保存，但运行时重新加载失败；新 endpoint 保持未启用，可稍后重试 reload");
            return error(result.message ?? "新增 endpoint 失败");
        }
        info(`已添加 endpoint ${id}（未启用、未保存 API Key）。请在列表中选择它来连接 API Key 并启用。`);
    };
    const editUrl = async (item) => {
        const baseUrl = await promptBaseUrl(`修改 ${item.id} 的 Base URL（ID 不可修改）`, item.baseUrl, item.baseUrl);
        if (baseUrl === undefined)
            return;
        if (baseUrl === item.baseUrl)
            return warn("Base URL 没有变化");
        const result = unwrap(await rpc.edit({ endpointId: item.id, baseUrl }));
        if (!result.ok)
            return error(result.message ?? "修改 Base URL 失败");
        info(`已更新 ${item.id} 的 Base URL`);
    };
    const connect = async (item, kind) => {
        const replacing = kind === "stored";
        const raw = await dialog.prompt({ title: `${replacing ? "替换" : "连接"} ${item.id} 的 API Key`, placeholder: "sk-xxx" });
        if (raw === undefined)
            return;
        const check = validateApiKey(raw);
        if (!check.ok)
            return warn(check.message);
        try {
            await saveKey(client, item.id, check.key, item.baseUrl);
            info(`${item.id} 的 API Key 已${replacing ? "替换" : "保存"}`);
        }
        catch (caught) {
            error(`保存 API Key 失败：${messageOf(caught).replaceAll(check.key, "***").replaceAll(item.baseUrl, "***")}`);
        }
    };
    const disconnect = async (item) => {
        const ok = await dialog.confirm({ title: "断开凭据", message: `仅删除 ${item.id} 已保存的 API Key；不会删除 endpoint，也不会改变启用状态。是否继续？` });
        if (!ok)
            return;
        try {
            await removeKeys(client, item.id);
            info(`已断开 ${item.id} 的凭据`);
        }
        catch (caught) {
            error(`断开凭据失败：${messageOf(caught)}`);
        }
    };
    /**
     * Delete runs entirely after the user's final confirmation. The confirmation comes FIRST — including
     * the internal legacy migration — so cancelling it leaves every kind of state untouched. Only after
     * Confirm does the migration run, then cleanup, then the definition is removed.
     */
    const deleteEndpoint = async (item) => {
        const ok = await dialog.confirm({
            title: `删除 endpoint ${item.id}`,
            message: item.legacy
                ? `该 endpoint 当前使用 legacy 单 endpoint 配置。确认删除后，将先完成内部迁移（写入 options.endpoints.${item.id}），然后立即删除：endpoint 配置、启用状态、已保存的 API Key、模型发现缓存/快照。此操作不可撤销。是否继续？`
                : "将彻底删除：endpoint 配置、启用状态、已保存的 API Key、模型发现缓存/快照。此操作不可撤销，其他 endpoint 不受影响。是否删除？",
        });
        if (!ok)
            return false;
        if (item.legacy && !(await migrateNow("；删除未执行")))
            return false;
        try {
            // Cleanup first, definition last: a mid-way failure leaves the endpoint visible so Delete can be retried.
            const prepared = unwrap(await rpc.prepareRemove({ endpointId: item.id }));
            if (!prepared.ok) {
                error(prepared.message ?? "删除失败");
                return false;
            }
            await removeKeys(client, item.id);
            const removed = unwrap(await rpc.remove({ endpointId: item.id }));
            if (!removed.ok) {
                error(`删除未完成（endpoint 定义仍保留，可重试）：${removed.message ?? ""}`);
                return false;
            }
            info(`已删除 endpoint ${item.id}`);
            return true;
        }
        catch (caught) {
            error(`删除未完成（endpoint 定义仍保留，可重试）：${messageOf(caught)}`);
            return false;
        }
    };
    /** One-way migration to the manageable config form; only called after the user already confirmed the action. */
    const migrateNow = async (failureNote = "") => {
        try {
            const result = unwrap(await rpc.migrate({}));
            if (!result.ok) {
                error(`${result.message ?? "迁移失败"}${failureNote}`);
                return false;
            }
            return true;
        }
        catch (caught) {
            error(`迁移失败：${messageOf(caught)}${failureNote}`);
            return false;
        }
    };
    /** Legacy default: Edit / Connect first migrate to the manageable config form, keeping every identity. */
    const ensureManaged = async (item, action) => {
        if (!item.legacy)
            return true;
        const ok = await dialog.confirm({
            title: "迁移为可管理配置",
            message: `${item.id} 目前是 legacy 单 endpoint 配置（地址保存在 /connect 凭据里）。${action}前需要把它迁移为 options.endpoints.${item.id}；` +
                "endpoint id、integration、已保存的 API Key 和启用状态保持不变，发现缓存会重新生成。是否继续？",
        });
        if (!ok)
            return false;
        return migrateNow();
    };
    const detail = async (id) => {
        for (;;) {
            if (deps.isDisposed())
                return;
            const state = await loadState();
            const item = itemsOf(state).find((entry) => entry.id === id);
            if (!item)
                return warn(`未知 LiteLLM endpoint：${id}`);
            const kind = await credentialKind(client, id);
            // Legacy default is fully manageable: Edit/Connect first migrate it to
            // options.endpoints.default (same id, integration and credential); Delete confirms first,
            // then migrates as part of the confirmed deletion.
            const canWrite = state.writable !== false;
            const enabled = item.state ? item.state.desired === "enabled" : item.active;
            const options = [
                { title: enabled ? "停用" : "启用", value: "toggle" },
                ...(canWrite ? [{ title: "修改 Base URL", value: "edit" }] : []),
                { title: kind === "stored" ? "替换 API Key" : "连接 API Key", value: "connect" },
                ...(kind === "stored" ? [{ title: "断开凭据", value: "disconnect" }] : []),
                ...(item.canRetry ? [{ title: "重新应用", value: "retry" }] : []),
                ...(canWrite ? [{ title: "删除 endpoint", value: "delete" }] : []),
                { title: "返回", value: "back" },
            ];
            const titleStatus = item.statusLabel ?? (enabled ? "已启用" : "未启用");
            const choice = await dialog.select({
                title: `${item.id}${item.baseUrl ? ` · ${item.baseUrl}` : ""} · ${titleStatus} · ${CRED_LABEL[kind]}`,
                options,
            });
            if (choice === undefined || choice === "back")
                return;
            if (choice === "toggle")
                await setActive(id);
            else if (choice === "disconnect")
                await disconnect(item);
            else if (choice === "edit" && (await ensureManaged(item, "修改 Base URL")))
                await editUrl(item);
            else if (choice === "connect" && (await ensureManaged(item, "管理 API Key")))
                await connect(item, kind);
            else if (choice === "retry") {
                const result = unwrap(await rpc.trigger({ endpointId: id }));
                if (result.ok)
                    info(`已重新触发 ${item.id} 的应用`);
                else
                    error(result.message ?? `重新应用 ${item.id} 失败`);
            }
            else if (choice === "delete" && (await deleteEndpoint(item)))
                return;
        }
    };
    /** Runs until the user dismisses the main list. */
    async function run(initial) {
        let state = initial;
        while (!deps.isDisposed()) {
            const items = itemsOf(state);
            const kinds = new Map();
            for (const item of items)
                kinds.set(item.id, await credentialKind(client, item.id));
            const choice = await dialog.select({
                title: "LiteLLM endpoints",
                placeholder: "选择 endpoint 或操作",
                options: [
                    { title: "＋ 新增 endpoint", value: "add", ...(state.writable === false ? { description: state.configProblem ?? "配置不可写" } : {}) },
                    ...(items.length > 0
                        ? [{ title: "全部启用", value: "all" }, { title: "全部停用", value: "none" }]
                        : []),
                    ...items.map((item) => {
                        const enabled = item.state ? item.state.desired === "enabled" : item.active;
                        const status = item.statusLabel ?? (enabled ? "已启用" : "未启用");
                        return {
                            title: `${enabled ? "✓" : "○"} ${item.id}`,
                            value: `endpoint:${item.id}`,
                            description: `${status} · ${CRED_LABEL[kinds.get(item.id) ?? "none"]}`,
                        };
                    }),
                ],
            });
            if (deps.isDisposed() || choice === undefined)
                return;
            if (choice === "add") {
                if (state.writable === false)
                    error(state.configProblem ?? "当前配置不可写，无法新增 endpoint");
                else
                    await addEndpoint(state);
            }
            else if (choice === "all" || choice === "none") {
                await rpc.set({ action: choice, endpointId: "" });
            }
            else if (choice.startsWith("endpoint:")) {
                await detail(choice.slice("endpoint:".length));
            }
            state = await loadState();
        }
    }
    return { run, activeList };
}
