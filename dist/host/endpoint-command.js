import { endpointRpc } from "./endpoint-rpc.js";
export async function registerEndpointActivation(context, endpointIds, read, apply) {
    let sequence = 0;
    let sessionID = "";
    let rpc;
    const view = () => {
        const activation = read();
        const selected = activation.mode === "all"
            ? [...endpointIds]
            : endpointIds.filter((id) => activation.endpointIds.includes(id));
        return {
            sequence,
            sessionID,
            mode: activation.mode,
            endpointIds: [...endpointIds],
            activeEndpointIds: selected,
        };
    };
    const show = async () => {
        sequence += 1;
        const next = view();
        await rpc.events.emit("shown", next);
        return next;
    };
    rpc = await context.rpc.register(endpointRpc, {
        async state() {
            return view();
        },
        async set(input) {
            const { action, endpointId } = input;
            const current = read();
            if (action === "all") {
                await apply({ mode: "all" });
            }
            else if (action === "none") {
                await apply({ mode: "selected", endpointIds: [] });
            }
            else if (action === "toggle" && endpointIds.includes(endpointId)) {
                const selected = new Set(current.mode === "all" ? endpointIds : current.endpointIds);
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
    });
    try {
        const command = await context.command.transform((editor) => {
            editor.add({
                name: "litellm-endpoints",
                description: "管理全局 LiteLLM endpoint activation",
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
