import { type JSX } from "@opentui/solid/jsx-runtime";
import type { Context } from "@opencode/plugin/tui/plugin";
export interface AuditResult {
    sequence: number;
    sessionID: string;
    ok: boolean;
    path: string;
    error: string;
}
export interface DiagnosticsResult {
    sequence: number;
    sessionID: string;
    lines: string[];
}
export interface EndpointActivationResult {
    sequence: number;
    sessionID: string;
    mode: "all" | "selected";
    endpointIds: string[];
    activeEndpointIds: string[];
}
export interface AuditCardActions {
    open: (path: string) => Promise<void>;
    copy: (path: string) => Promise<void>;
    manualCopy: (path: string) => Promise<unknown>;
}
export declare function createDiagnosticsResultStore(): {
    forSession: (sessionID: string) => DiagnosticsResult | undefined;
    accept(result: DiagnosticsResult): void;
    dismiss(sessionID: string): void;
};
export declare function createEndpointActivationStore(): {
    forSession: (sessionID: string) => EndpointActivationResult | undefined;
    accept(result: EndpointActivationResult): void;
    dismiss(sessionID: string): void;
};
export declare function createAuditResultStore(): {
    forSession: (sessionID: string) => AuditResult | undefined;
    accept(result: AuditResult): void;
    dismiss(sessionID: string): void;
};
export declare function createAuditCardController(actions: AuditCardActions): {
    feedback: import("solid-js").Accessor<string>;
    reset: () => void;
    act(kind: "open" | "copy", path: string): Promise<void>;
};
export declare function AuditCard(props: {
    result: () => AuditResult | undefined;
    foreground: () => NonNullable<JSX.IntrinsicElements["text"]["fg"]>;
    actions: AuditCardActions;
    onDismiss: () => void;
}): import("solid-js").JSX.Element;
export declare function auditCardActions(context: Pick<Context, "ui">): AuditCardActions;
export declare function DiagnosticsCard(props: {
    result: () => DiagnosticsResult | undefined;
    foreground: () => NonNullable<JSX.IntrinsicElements["text"]["fg"]>;
    onDismiss: () => void;
}): import("solid-js").JSX.Element;
export declare function EndpointActivationCard(props: {
    result: () => EndpointActivationResult | undefined;
    foreground: () => NonNullable<JSX.IntrinsicElements["text"]["fg"]>;
    onAction: (action: "all" | "none" | "toggle", endpointId?: string) => Promise<void>;
    onDismiss: () => void;
}): import("solid-js").JSX.Element;
export declare function ProviderCards(props: {
    auditResult: () => AuditResult | undefined;
    diagnosticsResult: () => DiagnosticsResult | undefined;
    endpointResult?: () => EndpointActivationResult | undefined;
    foreground: () => NonNullable<JSX.IntrinsicElements["text"]["fg"]>;
    actions: AuditCardActions;
    dismissAudit: () => void;
    dismissDiagnostics: () => void;
    dismissEndpoints?: () => void;
    endpointAction?: (action: "all" | "none" | "toggle", endpointId?: string) => Promise<void>;
}): import("solid-js").JSX.Element;
