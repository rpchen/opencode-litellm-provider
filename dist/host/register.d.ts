import type { ConnectionInfo } from "@opencode/client";
import { Model, Plugin, Provider } from "@opencode/plugin";
import type { ModelSpec } from "../core/build.js";
import type { DiscoveryCacheDiagnostics, DiscoveryDiagnostics } from "../generated/discovery-core/index.js";
import { type EndpointIdentity } from "../endpoints.js";
export interface Registration {
    readonly dispose: () => Promise<void>;
}
export type IntegrationEditorLike = Parameters<Parameters<Plugin.Context["integration"]["transform"]>[0]>[0];
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
export interface ProviderDiagnosticsSnapshot {
    readonly discovery?: DiscoveryDiagnostics;
    readonly cache?: DiscoveryCacheDiagnostics;
    readonly note?: string;
}
export interface ProviderSnapshot {
    ready: boolean;
    connection?: ConnectionInfo;
    apiBaseURL?: string;
    models: ModelSpec[];
    registrationView?: RegistrationView;
    audit?: AuditSnapshot;
    diagnostics?: ProviderDiagnosticsSnapshot;
}
export declare function applyIntegration(editor: IntegrationEditorLike, endpoint?: EndpointIdentity): void;
export declare function createRegistrationView(models: readonly ModelSpec[], apiBaseURL: string, endpoint?: EndpointIdentity): RegistrationView;
export declare function applyProvider(editor: ProviderEditorLike, snapshot: ProviderSnapshot, endpoint?: EndpointIdentity): void;
export declare function registerIntegration(context: Pick<Plugin.Context, "integration">, endpoint?: EndpointIdentity): Promise<Registration>;
export declare function registerIntegrations(context: Pick<Plugin.Context, "integration">, endpoints: readonly EndpointIdentity[]): Promise<Registration>;
export declare function registerProvider(context: Pick<Plugin.Context, "provider">, snapshot: ProviderSnapshot, endpoint?: EndpointIdentity): Promise<Registration>;
