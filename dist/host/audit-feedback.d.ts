import type { DiscoveryStatus } from "./register.js";
/**
 * 对话反馈通道：把一次导出结果转成最小化、确定性的会话消息，并提交给宿主。
 * 消息不含报告内容、模型清单、价格或凭据；路径按编码安全处理。
 */
export declare const FEEDBACK_MARKER = "[litellm \u63D2\u4EF6]";
export type AuditExportOutcome = {
    readonly ok: true;
    readonly path: string;
    readonly status: DiscoveryStatus;
    readonly modelCount: number;
} | {
    readonly ok: false;
    readonly error: string;
};
export declare function statusLabel(status: DiscoveryStatus): string;
/**
 * 路径是未受信任文本（状态目录由环境变量决定）。转义换行、制表与控制字符，
 * 避免路径内容改变消息结构或被读作额外指令。
 */
export declare function encodePathForMessage(path: string): string;
export declare function buildFeedbackMessage(outcome: AuditExportOutcome): string;
export interface FeedbackSessionDomain {
    prompt(input: {
        sessionID: string;
        text: string;
    }): Promise<unknown>;
}
export interface FeedbackSubmitter {
    submit(sessionID: string, outcome: AuditExportOutcome): Promise<boolean>;
}
export interface FeedbackSubmitterOptions {
    /** 有界等待上限，避免宿主挂起时无限阻塞命令。 */
    timeoutMs?: number;
    onError?: (error: unknown) => void;
}
/**
 * 提交反馈消息。任何失败都静默降级（返回 false），不重试、不抛出，不影响导出主流程。
 * 超时后仍对迟到 rejection 做处理，避免未处理拒绝。
 */
export declare function createFeedbackSubmitter(session: FeedbackSessionDomain, options?: FeedbackSubmitterOptions): FeedbackSubmitter;
