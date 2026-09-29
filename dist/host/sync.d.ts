import type { ConnectionInfo } from "@opencode/client";
import { buildModelSpecs, modelFingerprint } from "../core/build.js";
import type { PluginOptions } from "../options.js";
import { type EndpointIdentity } from "../endpoints.js";
import { fetchLiteLLMModelInfo, getModelsDevCatalog, type FetchLike } from "../net/fetch.js";
import { type ProviderSnapshot } from "./register.js";
interface EventLike {
    type: string;
    data?: unknown;
}
export interface SyncContext {
    integration: {
        connection: {
            active(integrationID: string): Promise<ConnectionInfo | undefined>;
            resolve(connection: ConnectionInfo): Promise<unknown>;
        };
    };
    provider: {
        reload(): Promise<void>;
    };
    event: {
        subscribe(options?: {
            signal?: AbortSignal;
        }): AsyncIterable<EventLike>;
    };
    storage?: {
        get(key: string): Promise<unknown>;
        set(key: string, value: unknown): Promise<void>;
        remove?(key: string): Promise<void>;
    };
}
export interface SyncLogger {
    warn(message: string): void;
    error(message: string): void;
}
export interface Scheduler {
    setTimeout(callback: () => void, milliseconds: number): unknown;
    clearTimeout(handle: unknown): void;
}
export interface DiscoveryDependencies {
    fetchImpl?: FetchLike;
    fetchLiteLLM?: typeof fetchLiteLLMModelInfo;
    getModelsDev?: typeof getModelsDevCatalog;
    buildModels?: typeof buildModelSpecs;
    fingerprint?: typeof modelFingerprint;
    logger?: SyncLogger;
    scheduler?: Scheduler;
}
export interface DiscoveryLoop {
    start(): Promise<void>;
    trigger(forceRefresh?: boolean): Promise<void>;
    dispose(): Promise<void>;
}
export declare function createDiscoveryLoop(context: SyncContext, snapshot: ProviderSnapshot, options: PluginOptions, dependencies?: DiscoveryDependencies, endpoint?: EndpointIdentity): DiscoveryLoop;
export {};
