import type { Plugin } from "@opencode/plugin";
import type { EndpointActivation } from "../endpoints.js";
import type { Registration } from "./register.js";
export type EndpointViewItem = {
    id: string;
    baseUrl: string;
    active: boolean;
    legacy: boolean;
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
    /** Re-read the canonical config before each view so hand edits are visible. */
    refresh?(): Promise<void>;
}
export declare function registerEndpointActivation(context: Pick<Plugin.Context, "rpc" | "command">, endpointIds: readonly string[] | (() => readonly string[]), read: () => EndpointActivation, apply: (next: EndpointActivation) => Promise<void>, management?: EndpointManagement): Promise<Registration>;
