import type { Plugin } from "@opencode/plugin";
import { writeAuditFile } from "./audit-file.js";
import type { ProviderSnapshot, Registration } from "./register.js";
interface MultiAuditDependencies {
    writeFile?: typeof writeAuditFile;
    now?: () => Date;
}
export declare function registerMultiEndpointAudit(context: Pick<Plugin.Context, "rpc" | "command">, endpointIds: readonly string[], activeEndpointIds: () => readonly string[], snapshots: ReadonlyMap<string, ProviderSnapshot>, dependencies?: MultiAuditDependencies): Promise<Registration>;
export {};
