import { dirname } from "node:path";
export type ConfigErrorCode = "no-file" | "no-entry" | "parse" | "shape" | "duplicate" | "invalid-id" | "invalid-url" | "not-found" | "conflict" | "legacy-conflict" | "needs-migration" | "legacy-default";
export declare class ConfigFileError extends Error {
    readonly code: ConfigErrorCode;
    constructor(code: ConfigErrorCode, message: string);
}
export interface ConfigTarget {
    file: string;
}
export declare function configCandidates(env?: Record<string, string | undefined>): string[];
type Json = unknown;
/** Does this plugin entry refer to this plugin? Uses the host-reported source when available. */
export declare function entryMatches(spec: string, sourceTarget?: string): boolean;
/** First candidate file that contains an entry for this plugin. */
export declare function locateConfig(env?: Record<string, string | undefined>, sourceTarget?: string): ConfigTarget | undefined;
export declare function readPluginOptions(target: ConfigTarget, sourceTarget?: string): Record<string, Json>;
export type EndpointMutation = {
    kind: "add";
    id: string;
    baseUrl: string;
    migrateLegacy?: {
        baseUrl: string;
    } | undefined;
    confirmMigration?: boolean;
} | {
    kind: "edit";
    id: string;
    baseUrl: string;
} | {
    kind: "delete";
    id: string;
};
export interface MutationResult {
    migratedLegacy: boolean;
}
export interface WriteOptions {
    sourceTarget?: string;
    rename?: (from: string, to: string) => void;
    /** Test seam: runs after edits are computed and before the conflict check. */
    beforeCommit?: () => void;
}
export declare function mutateEndpoints(target: ConfigTarget, mutation: EndpointMutation, options?: WriteOptions): MutationResult;
export { dirname };
