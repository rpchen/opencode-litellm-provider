import { define } from "@opencode/plugin/tui/plugin";
import { auditRpc } from "./host/audit-rpc.js";
import { ProviderCards, auditCardActions, createAuditResultStore, createDiagnosticsResultStore, } from "./tui-card.js";
function scheduleRefresh(refresh) {
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
}
export async function setupAuditTui(context, schedule = scheduleRefresh) {
    const rpc = context.client.rpc(auditRpc);
    const store = createAuditResultStore();
    const diagnosticsStore = createDiagnosticsResultStore();
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
    const remove = context.ui.slot({
        before: "session.composer.top",
        render: ({ sessionID }) => ProviderCards({
            auditResult: () => sessionID ? store.forSession(sessionID) : undefined,
            diagnosticsResult: () => sessionID ? diagnosticsStore.forSession(sessionID) : undefined,
            foreground: () => context.theme.text.base,
            actions,
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
        remove();
    };
}
export default define({ id: "litellm", setup: setupAuditTui });
