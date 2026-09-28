export declare const DEFAULT_DISCOVERY_TTL_MS = 30000;
export declare const DEFAULT_DISCOVERY_BACKOFF_MS: readonly [1000, 2000, 5000, 10000, 30000];
export type RefreshSource = "network" | "cache" | "stale";
export type RefreshFailurePolicy = "stale" | "clear" | "ignore";
export interface RefreshResult<T> {
    readonly value: T;
    readonly source: RefreshSource;
    readonly stale: boolean;
    readonly refreshedAt: number;
    readonly failureCount: number;
    readonly nextRetryAt?: number;
    readonly error?: unknown;
}
export interface RefreshState<T> {
    readonly hasValue: boolean;
    readonly value?: T;
    readonly refreshedAt?: number;
    readonly expiresAt?: number;
    readonly failureCount: number;
    readonly nextRetryAt?: number;
    readonly pending: boolean;
    readonly lastError?: unknown;
}
export interface DiscoveryCoordinatorOptions {
    readonly ttlMs?: number;
    readonly backoffMs?: readonly number[];
    readonly now?: () => number;
    readonly failurePolicy?: (error: unknown) => RefreshFailurePolicy;
}
export interface RefreshRequestOptions {
    readonly forceRefresh?: boolean;
    readonly failurePolicy?: (error: unknown) => RefreshFailurePolicy;
}
export interface DiscoveryCoordinator<T> {
    refresh(key: string, discover: () => Promise<T>, options?: RefreshRequestOptions): Promise<RefreshResult<T>>;
    state(key: string): RefreshState<T>;
    retryDelayMs(key: string): number | undefined;
    clear(key: string): void;
    clearAll(): void;
}
export declare function createDiscoveryCoordinator<T>(options?: DiscoveryCoordinatorOptions): DiscoveryCoordinator<T>;
