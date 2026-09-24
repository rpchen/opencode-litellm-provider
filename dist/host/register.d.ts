import type { ConnectionInfo } from "@opencode/client";
import { Model, Plugin, Provider } from "@opencode/plugin";
import type { ModelSpec } from "../core/build.js";
export interface Registration {
    readonly dispose: () => Promise<void>;
}
export interface IntegrationEditorLike {
    update(id: string, update: (integration: {
        id: string;
        name: string;
    }) => void): void;
    readonly method: {
        update(input: {
            integrationID: string;
            method: {
                type: "key";
                label: string;
                form: Array<{
                    key: string;
                    type: "string";
                    format: "uri";
                    required: boolean;
                    title: string;
                    placeholder: string;
                }>;
            };
        }): void;
    };
}
export interface ProviderEditorLike {
    add(input: {
        info: Provider.Info;
        models: readonly Model.Info[];
        sourceConnection?: ConnectionInfo;
    }): void;
}
export declare const INTEGRATION_ID = "litellm";
export declare const PROVIDER_ID = "litellm";
export type DiscoveryStatus = "disconnected" | "pending" | "switching" | "ready" | "empty" | "stale" | "cleared-auth" | "cleared-notfound";
export interface RegistrationView {
    readonly info: Provider.Info;
    readonly models: readonly Model.Info[];
    readonly protocols: Readonly<Record<string, ModelSpec["protocol"]>>;
    readonly releaseUnits: Readonly<Record<string, NonNullable<ModelSpec["releaseUnit"]>>>;
}
export interface AuditSnapshot {
    readonly status: DiscoveryStatus;
    readonly lastSuccessfulDiscoveryAt?: string;
    readonly view?: RegistrationView;
}
export interface ProviderSnapshot {
    ready: boolean;
    connection?: ConnectionInfo;
    apiBaseURL?: string;
    models: ModelSpec[];
    registrationView?: RegistrationView;
    audit?: AuditSnapshot;
}
export declare function applyIntegration(editor: IntegrationEditorLike): void;
export declare function createRegistrationView(models: readonly ModelSpec[], apiBaseURL: string): RegistrationView;
export declare function applyProvider(editor: ProviderEditorLike, snapshot: ProviderSnapshot): void;
export declare function registerIntegration(context: Pick<Plugin.Context, "integration">): Promise<Registration>;
export declare function registerProvider(context: Pick<Plugin.Context, "provider">, snapshot: ProviderSnapshot): Promise<Registration>;
