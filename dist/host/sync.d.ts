import type { ConnectionInfo } from "@opencode/client";
import { buildModelSpecs, modelFingerprint } from "../core/build.js";
import type { PluginOptions } from "../options.js";
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
    trigger(): Promise<void>;
    dispose(): Promise<void>;
}
export declare function createDiscoveryLoop(context: SyncContext, snapshot: ProviderSnapshot, options: PluginOptions, dependencies?: DiscoveryDependencies): DiscoveryLoop;
export {};
