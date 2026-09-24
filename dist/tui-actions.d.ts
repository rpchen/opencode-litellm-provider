import { execFile as callback } from "node:child_process";
declare const execFile: typeof callback.__promisify__;
type Runner = typeof execFile;
export declare function openAuditReport(path: string, run?: Runner): Promise<void>;
export declare function copyAuditPath(path: string, run?: Runner): Promise<void>;
export {};
