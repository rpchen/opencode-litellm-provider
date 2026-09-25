import type { Plugin } from "@opencode/plugin";
import { writeAuditFile } from "./audit-file.js";
import { type FeedbackSubmitter } from "./audit-feedback.js";
import type { ProviderSnapshot, Registration } from "./register.js";
export interface AuditDependencies {
    writeFile?: typeof writeAuditFile;
    now?: () => Date;
    /** 对话反馈开关；默认关闭。关闭时不得调用会话输入 API。 */
    conversationFeedback?: boolean;
    /** 便于测试注入的反馈提交器工厂。 */
    createSubmitter?: (session: Pick<Plugin.Context["session"], "prompt">) => FeedbackSubmitter;
}
export declare function registerAudit(context: Pick<Plugin.Context, "rpc" | "command" | "session">, snapshot: ProviderSnapshot, dependencies?: AuditDependencies): Promise<Registration>;
