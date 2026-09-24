import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "@opentui/solid/jsx-runtime";
import { createEffect, createSignal, Show } from "solid-js";
import { copyAuditPath, openAuditReport } from "./tui-actions.js";
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
    const controller = createAuditCardController(props.actions);
    createEffect(() => {
        props.result()?.sequence;
        controller.reset();
    });
    return Show({
        get when() { return props.result(); },
        keyed: true,
        children: (result) => _jsxs("box", { flexDirection: "column", paddingLeft: 2, paddingRight: 2, marginBottom: 1, children: [_jsx("text", { children: result.ok ? "LiteLLM 审查报告已导出" : "LiteLLM 审查报告导出失败" }), result.ok ? _jsxs(_Fragment, { children: [_jsx("text", { wrapMode: "char", onMouseUp: () => { void controller.act("open", result.path); }, children: _jsx("u", { children: result.path }) }), _jsxs("box", { flexDirection: "row", gap: 2, children: [_jsx("text", { onMouseUp: () => { void controller.act("open", result.path); }, children: "[\u6253\u5F00\u62A5\u544A]" }), _jsx("text", { onMouseUp: () => { void controller.act("copy", result.path); }, children: "[\u590D\u5236\u8DEF\u5F84]" })] })] }) : _jsx("text", { children: result.error }), Show({
                    get when() { return controller.feedback() || undefined; },
                    keyed: true,
                    children: (message) => _jsx("text", { children: message }),
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
