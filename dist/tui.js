import { define } from "@opencode/plugin/tui/plugin";
import { auditRpc } from "./host/audit-rpc.js";
import { endpointRpc } from "./host/endpoint-rpc.js";
import { ProviderCards, auditCardActions, createAuditResultStore, createDiagnosticsResultStore, } from "./tui-card.js";
function scheduleRefresh(refresh) {
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
}
export async function setupAuditTui(context, schedule = scheduleRefresh) {
    const rpc = context.client.rpc(auditRpc);
    const endpointClient = context.client.rpc(endpointRpc);
    const store = createAuditResultStore();
    const diagnosticsStore = createDiagnosticsResultStore();
    const actions = auditCardActions(context);
    let disposed = false;
    let endpointSequence = 0;
    let endpointDialogRunning = false;
    let pendingEndpoint;
    const acceptVisible = (data) => {
        if (Array.isArray(data.lines)) {
            diagnosticsStore.accept({
                sequence: data.sequence,
                sessionID: data.sessionID,
                lines: data.lines,
            });
        }
        else {
            store.accept(data);
        }
    };
    const currentSessionIs = (sessionID) => {
        const route = context.ui.router.current();
        return route.type === "session" && route.sessionID === sessionID;
    };
    const showEndpoints = async (initial) => {
        if (disposed ||
            !initial.sessionID ||
            initial.sequence <= endpointSequence ||
            !currentSessionIs(initial.sessionID))
            return;
        if (endpointDialogRunning) {
            pendingEndpoint = initial;
            return;
        }
        endpointSequence = initial.sequence;
        endpointDialogRunning = true;
        try {
            let current = initial;
            while (!disposed) {
                const active = new Set(current.activeEndpointIds);
                const selected = await context.ui.dialog.select({
                    title: "LiteLLM endpoints",
                    placeholder: "选择 endpoint 或操作",
                    options: [
                        ...current.endpointIds.map((id) => ({
                            title: `${active.has(id) ? "✓" : "○"} ${id}`,
                            value: `toggle:${id}`,
                            description: active.has(id) ? "已启用" : "已停用",
                        })),
                        { title: "全部启用", value: "all" },
                        { title: "全部停用", value: "none" },
                        { title: "关闭", value: "close" },
                    ],
                });
                if (disposed || selected === undefined || selected === "close")
                    break;
                let action;
                let endpointId = "";
                if (selected === "all" || selected === "none") {
                    action = selected;
                }
                else if (selected.startsWith("toggle:")) {
                    action = "toggle";
                    endpointId = selected.slice("toggle:".length);
                }
                else {
                    continue;
                }
                current = await endpointClient.set({ action, endpointId });
            }
        }
        catch {
            if (!disposed) {
                context.ui.toast.show({
                    variant: "error",
                    message: "LiteLLM endpoint activation 更新失败，请重试",
                });
            }
        }
        finally {
            endpointDialogRunning = false;
            const next = pendingEndpoint;
            pendingEndpoint = undefined;
            if (next && !disposed)
                void showEndpoints(next);
        }
    };
    const stop = rpc.events.on("completed", (event) => {
        acceptVisible(event.data);
    });
    const stopEndpoints = endpointClient.events.on("shown", (event) => {
        void showEndpoints(event.data);
    });
    const remove = context.ui.slot({
        before: "session.composer.top",
        render: ({ sessionID }) => ProviderCards({
            auditResult: () => sessionID ? store.forSession(sessionID) : undefined,
            diagnosticsResult: () => sessionID ? diagnosticsStore.forSession(sessionID) : undefined,
            foreground: () => context.theme.text.base,
            actions,
            dismissAudit: () => { if (sessionID)
                store.dismiss(sessionID); },
            dismissDiagnostics: () => { if (sessionID)
                diagnosticsStore.dismiss(sessionID); },
        }),
    });
    let refreshing = false;
    const refresh = async () => {
        if (refreshing || disposed)
            return;
        refreshing = true;
        try {
            try {
                const result = await rpc.latest({});
                if (!disposed)
                    acceptVisible(result);
            }
            catch {
                // 服务器可能尚未完成插件注册；后续轮询会继续尝试。
            }
            try {
                const state = await endpointClient.state({});
                if (!disposed)
                    void showEndpoints(state);
            }
            catch {
                // endpoint RPC 与主插件异步就绪；后续轮询会继续尝试。
            }
        }
        finally {
            refreshing = false;
        }
    };
    const stopRefresh = schedule(() => { void refresh(); });
    await refresh();
    return () => {
        disposed = true;
        if (endpointDialogRunning)
            context.ui.dialog.clear();
        stopRefresh();
        stop();
        stopEndpoints();
        remove();
    };
}
export default define({ id: "litellm", setup: setupAuditTui });
