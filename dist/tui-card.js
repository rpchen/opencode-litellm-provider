import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "@opentui/solid/jsx-runtime";
import { createEffect, createSignal, Show } from "solid-js";
import { jsx } from "@opentui/solid/jsx-runtime";
import { copyAuditPath, openAuditReport } from "./tui-actions.js";
export function createDiagnosticsResultStore() {
    const [results, setResults] = createSignal({});
    let seen = 0;
    return {
        forSession: (sessionID) => results()[sessionID],
        accept(result) {
            if (result.sequence <= seen || !result.sessionID)
                return;
            seen = result.sequence;
            setResults((previous) => ({ ...previous, [result.sessionID]: result }));
        },
        dismiss(sessionID) {
            if (!sessionID)
                return;
            setResults((previous) => {
                if (!(sessionID in previous))
                    return previous;
                const next = { ...previous };
                delete next[sessionID];
                return next;
            });
        },
    };
}
export function createEndpointActivationStore() {
    const [results, setResults] = createSignal({});
    let seen = 0;
    return {
        forSession: (sessionID) => results()[sessionID],
        accept(result) {
            if (!result ||
                typeof result.sequence !== "number" ||
                !result.sessionID ||
                (result.mode !== "all" && result.mode !== "selected") ||
                !Array.isArray(result.endpointIds) ||
                !Array.isArray(result.activeEndpointIds) ||
                result.endpointIds.some((id) => typeof id !== "string") ||
                result.activeEndpointIds.some((id) => typeof id !== "string") ||
                result.sequence < seen)
                return;
            seen = result.sequence;
            setResults((previous) => ({ ...previous, [result.sessionID]: result }));
        },
        dismiss(sessionID) {
            setResults((previous) => {
                const next = { ...previous };
                delete next[sessionID];
                return next;
            });
        },
    };
}
export function createAuditResultStore() {
    const [results, setResults] = createSignal({});
    let seen = 0;
    return {
        forSession: (sessionID) => results()[sessionID],
        accept(result) {
            if (result.sequence <= seen || !result.sessionID)
                return;
            seen = result.sequence;
            setResults((previous) => ({ ...previous, [result.sessionID]: result }));
        },
        dismiss(sessionID) {
            if (!sessionID)
                return;
            setResults((previous) => {
                if (!(sessionID in previous))
                    return previous;
                const next = { ...previous };
                delete next[sessionID];
                return next;
            });
        },
    };
}
export function createAuditCardController(actions) {
    const [feedback, setFeedback] = createSignal("");
    let version = 0;
    return {
        feedback,
        reset: () => { version++; setFeedback(""); },
        async act(kind, path) {
            const current = ++version;
            try {
                await actions[kind](path);
                if (current === version)
                    setFeedback(kind === "open" ? "已请求系统打开报告" : "路径已复制到剪贴板");
            }
            catch {
                if (current !== version)
                    return;
                setFeedback(kind === "open" ? "打开失败，请使用上方路径手动查找文件" : "复制失败，请在输入框中手动复制路径");
                if (kind === "copy") {
                    try {
                        await actions.manualCopy(path);
                    }
                    catch {
                        // 路径仍在卡片中，不再展示底层系统错误。
                    }
                }
            }
        },
    };
}
export function AuditCard(props) {
    // 自动 JSX runtime 需要 getter，才能让已挂载文本跟随宿主主题变化。
    const Text = (text) => jsx("text", {
        ...text,
        get fg() { return props.foreground(); },
    });
    const controller = createAuditCardController(props.actions);
    createEffect(() => {
        props.result()?.sequence;
        controller.reset();
    });
    return Show({
        get when() { return props.result(); },
        keyed: true,
        children: (result) => _jsxs("box", { flexDirection: "column", paddingLeft: 2, paddingRight: 2, marginBottom: 1, children: [_jsx(Text, { children: result.ok ? "LiteLLM 审查报告已导出" : "LiteLLM 审查报告导出失败" }), result.ok ? _jsxs(_Fragment, { children: [_jsx(Text, { wrapMode: "char", onMouseUp: () => { void controller.act("open", result.path); }, children: _jsx("u", { children: result.path }) }), _jsxs("box", { flexDirection: "row", gap: 2, children: [_jsx(Text, { onMouseUp: () => { void controller.act("open", result.path); }, children: "[\u6253\u5F00\u62A5\u544A]" }), _jsx(Text, { onMouseUp: () => { void controller.act("copy", result.path); }, children: "[\u590D\u5236\u8DEF\u5F84]" }), _jsx(Text, { onMouseUp: props.onDismiss, children: "[\u5173\u95ED]" })] })] }) : _jsxs(_Fragment, { children: [_jsx(Text, { children: result.error }), _jsx(Text, { onMouseUp: props.onDismiss, children: "[\u5173\u95ED]" })] }), Show({
                    get when() { return controller.feedback() || undefined; },
                    keyed: true,
                    children: (message) => _jsx(Text, { children: message }),
                })] }),
    });
}
export function auditCardActions(context) {
    return {
        open: openAuditReport,
        copy: copyAuditPath,
        manualCopy: (path) => context.ui.dialog.prompt({ title: "手动复制报告路径", value: path }),
    };
}
export function DiagnosticsCard(props) {
    const Text = (text) => jsx("text", {
        ...text,
        get fg() { return props.foreground(); },
    });
    return Show({
        get when() { return props.result(); },
        keyed: true,
        children: (result) => _jsxs("box", { flexDirection: "column", paddingLeft: 2, paddingRight: 2, marginBottom: 1, children: [result.lines.map((line) => _jsx(Text, { wrapMode: "char", children: line })), _jsx(Text, { onMouseUp: props.onDismiss, children: "[\u5173\u95ED]" })] }),
    });
}
export function EndpointActivationCard(props) {
    const Text = (text) => jsx("text", {
        ...text,
        get fg() { return props.foreground(); },
    });
    return Show({
        get when() { return props.result(); },
        keyed: true,
        children: (result) => {
            const active = new Set(result.activeEndpointIds);
            return _jsxs("box", { flexDirection: "column", paddingLeft: 2, paddingRight: 2, marginBottom: 1, children: [_jsx(Text, { children: "LiteLLM endpoints" }), result.endpointIds.map((id) => _jsxs(Text, { onMouseUp: () => { void props.onAction("toggle", id); }, children: [active.has(id) ? "✓" : "○", " ", id] })), _jsxs("box", { flexDirection: "row", gap: 2, children: [_jsx(Text, { onMouseUp: () => { void props.onAction("all"); }, children: "[\u5168\u90E8\u542F\u7528]" }), _jsx(Text, { onMouseUp: () => { void props.onAction("none"); }, children: "[\u5168\u90E8\u505C\u7528]" }), _jsx(Text, { onMouseUp: props.onDismiss, children: "[\u5173\u95ED]" })] })] });
        },
    });
}
export function ProviderCards(props) {
    return _jsxs("box", { flexDirection: "column", children: [_jsx(EndpointActivationCard, { result: () => props.endpointResult?.(), foreground: props.foreground, onAction: (action, endpointId) => props.endpointAction?.(action, endpointId) ?? Promise.resolve(), onDismiss: () => props.dismissEndpoints?.() }), _jsx(DiagnosticsCard, { result: props.diagnosticsResult, foreground: props.foreground, onDismiss: props.dismissDiagnostics }), _jsx(AuditCard, { result: props.auditResult, foreground: props.foreground, actions: props.actions, onDismiss: props.dismissAudit })] });
}
