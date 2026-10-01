import { endpointRpc } from "./endpoint-rpc.js";
export async function registerEndpointActivation(context, endpointIds, read, apply, management) {
    let sequence = 0;
    let sessionID = "";
    let rpc;
    const ids = () => (typeof endpointIds === "function" ? [...endpointIds()] : [...endpointIds]);
    const view = () => {
        const activation = read();
        const all = ids();
        const selected = activation.mode === "all"
            ? all
            : all.filter((id) => activation.endpointIds.includes(id));
        const base = {
            sequence,
            sessionID,
            mode: activation.mode,
            endpointIds: all,
            activeEndpointIds: selected,
        };
        if (!management)
            return base;
        const state = management.writable();
        return {
            ...base,
            endpoints: management.endpoints(),
            writable: state.writable,
            ...(state.problem ? { configProblem: state.problem } : {}),
            legacyMigration: state.legacyMigration,
        };
    };
    const mutation = async (run) => {
        if (!management)
            return { ok: false, code: "unsupported", message: "endpoint 管理不可用", state: view() };
        const outcome = await run();
        return { ...outcome, state: view() };
    };
    const show = async () => {
        await management?.refresh?.();
        sequence += 1;
        const next = view();
        await rpc.events.emit("shown", next);
        return next;
    };
    const handlers = {
        async state() {
            await management?.refresh?.();
            return view();
        },
        async set(input) {
            const { action, endpointId } = input;
            const current = read();
            const all = ids();
            if (action === "all") {
                await apply({ mode: "all" });
            }
            else if (action === "none") {
                await apply({ mode: "selected", endpointIds: [] });
            }
            else if (action === "toggle" && all.includes(endpointId)) {
                const selected = new Set(current.mode === "all" ? all : current.endpointIds);
                if (selected.has(endpointId))
                    selected.delete(endpointId);
                else
                    selected.add(endpointId);
                await apply({ mode: "selected", endpointIds: [...selected] });
            }
            // Mutating activation updates the selector's returned state, but it is not
            // a new request to open another selector. Keep the show sequence stable.
            return view();
        },
        add: (input) => mutation(() => management.add(input)),
        edit: (input) => mutation(() => management.edit(input)),
        prepareRemove: (input) => mutation(() => management.prepareRemove(input)),
        remove: (input) => mutation(() => management.remove(input)),
        migrate: () => mutation(() => management.migrate()),
    };
    rpc = await context.rpc.register(endpointRpc, handlers);
    try {
        const command = await context.command.transform((editor) => {
            editor.add({
                name: "litellm-endpoints",
                description: "管理全局 LiteLLM endpoint：新增、修改、删除、启用/停用、凭据",
                async execute(input) {
                    sessionID = input.sessionID;
                    await show();
                },
            });
        });
        return {
            async dispose() {
                await command.dispose();
                await rpc.dispose();
            },
        };
    }
    catch (error) {
        await rpc.dispose();
        throw error;
    }
}
