export interface EndpointViewItem {
    id: string;
    baseUrl: string;
    active: boolean;
    legacy: boolean;
}
export interface EndpointStateView {
    sequence: number;
    sessionID: string;
    mode: "all" | "selected";
    endpointIds: string[];
    activeEndpointIds: string[];
    endpoints?: EndpointViewItem[];
    writable?: boolean;
    configProblem?: string;
    legacyMigration?: boolean;
}
export interface MutationResultView {
    ok: boolean;
    code?: string;
    message?: string;
    migrated?: boolean;
    state: EndpointStateView;
}
export interface EndpointRpcClient {
    state(input: Record<string, never>): Promise<unknown>;
    set(input: {
        action: string;
        endpointId: string;
    }): Promise<unknown>;
    add(input: {
        endpointId: string;
        baseUrl: string;
        confirmMigration?: boolean;
    }): Promise<unknown>;
    edit(input: {
        endpointId: string;
        baseUrl: string;
    }): Promise<unknown>;
    prepareRemove(input: {
        endpointId: string;
    }): Promise<unknown>;
    remove(input: {
        endpointId: string;
    }): Promise<unknown>;
}
export interface ConnectionLike {
    type: string;
    id?: string;
    name?: string;
}
export interface CredentialClient {
    integration: {
        get(input: {
            integrationID: string;
        }): Promise<unknown>;
        connect: {
            key(input: {
                integrationID: string;
                key: string;
                label?: string;
            }): Promise<unknown>;
        };
    };
    credential: {
        remove(input: {
            credentialID: string;
        }): Promise<unknown>;
        activate(input: {
            credentialID: string;
        }): Promise<unknown>;
    };
}
export interface DialogLike {
    select<Value>(options: {
        title: string;
        placeholder?: string;
        options: ReadonlyArray<{
            title: string;
            value: Value;
            description?: string;
        }>;
    }): Promise<Value | undefined>;
    prompt(options: {
        title: string;
        description?: string;
        placeholder?: string;
        value?: string;
    }): Promise<string | undefined>;
    confirm(options: {
        title: string;
        message: string;
        label?: {
            confirm?: string;
            cancel?: string;
        };
    }): Promise<boolean | undefined>;
}
export interface ToastLike {
    show(input: {
        variant: "info" | "success" | "warning" | "error";
        message: string;
    }): void;
}
export declare const integrationIdFor: (endpointId: string) => string;
export declare function connectionsOf(client: CredentialClient, endpointId: string): Promise<ConnectionLike[]>;
export type CredentialKind = "stored" | "environment" | "none";
export declare function credentialKind(client: CredentialClient, endpointId: string): Promise<CredentialKind>;
/** Connect (or replace) an endpoint's key through the host credential store. The key is never returned. */
export declare function saveKey(client: CredentialClient, endpointId: string, key: string): Promise<void>;
/** Disconnect removes only this endpoint's stored credentials (env connections are not ours to remove). */
export declare function removeKeys(client: CredentialClient, endpointId: string): Promise<void>;
export interface EndpointUiDeps {
    dialog: DialogLike;
    toast: ToastLike;
    rpc: EndpointRpcClient;
    client: CredentialClient;
    isDisposed: () => boolean;
}
export declare function createEndpointUi(deps: EndpointUiDeps): {
    run: (initial: EndpointStateView) => Promise<void>;
    activeList: (state: EndpointStateView) => string[];
};
