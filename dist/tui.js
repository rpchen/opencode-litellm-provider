import { define } from "@opencode/plugin/tui/plugin";
import { auditRpc } from "./host/audit-rpc.js";
import { endpointRpc } from "./host/endpoint-rpc.js";
import { createEndpointUi } from "./tui-endpoints.js";
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
    const endpointUi = createEndpointUi({
        dialog: context.ui.dialog,
        toast: context.ui.toast,
        rpc: endpointClient,
        client: context.client,
        isDisposed: () => disposed,
    });
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
            await endpointUi.run(initial);
        }
        catch {
            if (!disposed) {
                context.ui.toast.show({
                    variant: "error",
                    message: "LiteLLM endpoint 管理操作失败，请重试",
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
