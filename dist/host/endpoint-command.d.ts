import type { Plugin } from "@opencode/plugin";
import type { EndpointActivation } from "../endpoints.js";
import type { EndpointState, UserVisibleStatus } from "./endpoint-state.js";
import type { Registration } from "./register.js";
/**
 * One row of the /litellm-endpoints list. New-style servers populate `state` /
 * `status` / `statusLabel` / `canRetry`; older servers only fill `active` and
 * `legacy`. The TUI consumes `state` when present, otherwise falls back to the
 * legacy summary.
 */
export type EndpointViewItem = {
    id: string;
    baseUrl: string;
    /** @deprecated Use `state.desired === "enabled"`. Kept for backward compatibility. */
    active: boolean;
    legacy: boolean;
    state?: EndpointState;
    status?: UserVisibleStatus;
    statusLabel?: string;
    canRetry?: boolean;
};
export type EndpointActivationView = {
    sequence: number;
    sessionID: string;
    mode: "all" | "selected";
    endpointIds: string[];
    activeEndpointIds: string[];
    endpoints?: EndpointViewItem[];
    writable?: boolean;
    configProblem?: string;
    legacyMigration?: boolean;
};
export type MutationView = {
    ok: boolean;
    code?: string;
    message?: string;
    migrated?: boolean;
    /** The config mutation is persisted even though the operation failed (post-commit reload failure). */
    saved?: boolean;
    state: EndpointActivationView;
};
/** CRUD operations behind `/litellm-endpoints`; optional so pure-activation callers keep working. */
export interface EndpointManagement {
    endpoints(): EndpointViewItem[];
    writable(): {
        writable: boolean;
        problem?: string;
        legacyMigration: boolean;
    };
    add(input: {
        endpointId: string;
        baseUrl: string;
        confirmMigration?: boolean;
    }): Promise<Omit<MutationView, "state">>;
    edit(input: {
        endpointId: string;
        baseUrl: string;
    }): Promise<Omit<MutationView, "state">>;
    prepareRemove(input: {
        endpointId: string;
    }): Promise<Omit<MutationView, "state">>;
    remove(input: {
        endpointId: string;
    }): Promise<Omit<MutationView, "state">>;
    /** Migrate the legacy single-endpoint configuration to explicit `endpoints.default` (no identity change). */
    migrate(): Promise<Omit<MutationView, "state">>;
    /** Retry / 重新应用: force a forced refresh of one endpoint. Refuses invalid state with code=invalid-state. */
    trigger(input: {
        endpointId: string;
    }): Promise<Omit<MutationView, "state">>;
    /** Re-read the canonical config before each view so hand edits are visible. */
    refresh?(): Promise<void>;
}
export declare function registerEndpointActivation(context: Pick<Plugin.Context, "rpc" | "command">, endpointIds: readonly string[] | (() => readonly string[]), read: () => EndpointActivation, apply: (next: EndpointActivation) => Promise<void>, management?: EndpointManagement): Promise<Registration>;
