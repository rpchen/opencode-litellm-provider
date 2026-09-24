import type { Plugin } from "@opencode/plugin";
import { writeAuditFile } from "./audit-file.js";
import type { ProviderSnapshot, Registration } from "./register.js";
export interface AuditDependencies {
    writeFile?: typeof writeAuditFile;
    now?: () => Date;
}
export declare function registerAudit(context: Pick<Plugin.Context, "rpc" | "command">, snapshot: ProviderSnapshot, dependencies?: AuditDependencies): Promise<Registration>;
