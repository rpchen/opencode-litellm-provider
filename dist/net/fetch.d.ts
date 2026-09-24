import type { LiteLLMAddresses } from "../core/litellm.js";
export type DiscoveryErrorKind = "network" | "auth" | "notfound" | "ratelimit" | "server" | "parse" | "redirect";
export declare class DiscoveryError extends Error {
    readonly kind: DiscoveryErrorKind;
    readonly status?: number | undefined;
    constructor(kind: DiscoveryErrorKind, message: string, status?: number | undefined);
}
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export interface FetchJSONOptions {
    url: string;
    key?: string;
    timeoutMs: number;
    fetchImpl?: FetchLike;
}
export interface CacheLogger {
    warn(message: string): void;
}
export declare function redact(value: string, key?: string): string;
export declare function fetchJSON(options: FetchJSONOptions): Promise<unknown>;
export declare function fetchLiteLLMModelInfo(addresses: LiteLLMAddresses, key: string, fetchImpl?: FetchLike): Promise<unknown>;
export interface ModelsDevOptions {
    fetchImpl?: FetchLike;
    now?: () => number;
    logger?: CacheLogger;
    url?: string;
}
export declare function getModelsDevCatalog(options?: ModelsDevOptions): Promise<unknown>;
export declare function resetModelsDevCacheForTest(): void;
