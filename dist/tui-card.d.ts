import type { Context } from "@opencode/plugin/tui/plugin";
export interface AuditResult {
    sequence: number;
    sessionID: string;
    ok: boolean;
    path: string;
    error: string;
}
export interface AuditCardActions {
    open: (path: string) => Promise<void>;
    copy: (path: string) => Promise<void>;
    manualCopy: (path: string) => Promise<unknown>;
}
export declare function createAuditResultStore(): {
    forSession: (sessionID: string) => AuditResult | undefined;
    accept(result: AuditResult): void;
};
export declare function createAuditCardController(actions: AuditCardActions): {
    feedback: import("solid-js").Accessor<string>;
    reset: () => void;
    act(kind: "open" | "copy", path: string): Promise<void>;
};
export declare function AuditCard(props: {
    result: () => AuditResult | undefined;
    actions: AuditCardActions;
}): import("solid-js").JSX.Element;
export declare function auditCardActions(context: Pick<Context, "ui">): AuditCardActions;
