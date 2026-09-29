import { define } from "@opencode/plugin/tui/plugin";
import { auditRpc } from "./host/audit-rpc.js";
import { endpointRpc } from "./host/endpoint-rpc.js";
import { ProviderCards, auditCardActions, createAuditResultStore, createDiagnosticsResultStore, createEndpointActivationStore, } from "./tui-card.js";
function scheduleRefresh(refresh) {
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
}
export async function setupAuditTui(context, schedule = scheduleRefresh) {
    const rpc = context.client.rpc(auditRpc);
    const endpointClient = context.client.rpc(endpointRpc);
    const store = createAuditResultStore();
    const diagnosticsStore = createDiagnosticsResultStore();
    const endpointStore = createEndpointActivationStore();
    const actions = auditCardActions(context);
    const stop = rpc.events.on("completed", (event) => {
        const data = event.data;
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
    });
    const stopEndpoints = endpointClient.events.on("shown", (event) => {
        endpointStore.accept(event.data);
    });
    const remove = context.ui.slot({
        before: "session.composer.top",
        render: ({ sessionID }) => ProviderCards({
            auditResult: () => sessionID ? store.forSession(sessionID) : undefined,
            diagnosticsResult: () => sessionID ? diagnosticsStore.forSession(sessionID) : undefined,
            endpointResult: () => sessionID ? endpointStore.forSession(sessionID) : undefined,
            foreground: () => context.theme.text.base,
            actions,
            dismissAudit: () => { if (sessionID)
                store.dismiss(sessionID); },
            dismissDiagnostics: () => { if (sessionID)
                diagnosticsStore.dismiss(sessionID); },
            dismissEndpoints: () => { if (sessionID)
                endpointStore.dismiss(sessionID); },
            endpointAction: async (action, endpointId) => {
                const next = await endpointClient.set({ action, endpointId: endpointId ?? "" });
                endpointStore.accept(next);
            },
        }),
    });
    let refreshing = false;
    let disposed = false;
    const refresh = async () => {
        if (refreshing || disposed)
            return;
        refreshing = true;
        try {
            const result = await rpc.latest({});
            if (!disposed)
                store.accept(result);
        }
        catch {
            // 服务器可能尚未完成插件注册；后续轮询会继续尝试。
        }
        finally {
            refreshing = false;
        }
    };
    const stopRefresh = schedule(() => { void refresh(); });
    await refresh();
    return () => {
        disposed = true;
        stopRefresh();
        stop();
        stopEndpoints();
        remove();
    };
}
export default define({ id: "litellm", setup: setupAuditTui });
