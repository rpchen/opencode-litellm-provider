import type { AuditSnapshot } from "./register.js";
export declare function createAuditReport(snapshot: AuditSnapshot, now?: Date): object;
export declare function createMultiEndpointAuditReport(endpoints: readonly {
    id: string;
    snapshot: AuditSnapshot;
}[], now?: Date): object;
