export type NormalizedCatalogKind = "complete" | "providers-only" | "unavailable";
export interface NormalizedCatalog {
    readonly kind: NormalizedCatalogKind;
    /** Canonical registry: `<lab>/<model>` -> entry. Empty unless complete. */
    readonly models: Readonly<Record<string, unknown>>;
    /** Serving records: provider -> { models: {...} }. Empty unless complete. */
    readonly providers: Readonly<Record<string, unknown>>;
}
/**
 * Normalize any supplied catalog value into an exhaustive tri-state.
 * Never throws; unknown shapes are `unavailable`.
 */
export declare function normalizeModelsDevCatalog(input: unknown): NormalizedCatalog;
/** True when canonical resolution and serving selection may run. */
export declare function isCompleteCatalog(catalog: NormalizedCatalog): boolean;
