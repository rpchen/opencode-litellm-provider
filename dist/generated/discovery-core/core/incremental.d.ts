import type { DiscoveryDiagnostics } from "./diagnostics.js";
import type { PublicationResult } from "./publication.js";
export interface ModelNameDelta {
    readonly current: readonly string[];
    readonly added: readonly string[];
    readonly removed: readonly string[];
    readonly unchanged: ReadonlySet<string>;
}
/** Return the eligible conversational model identities in stable order. */
export declare function modelNamesOfResponse(response: unknown): string[];
/** Compare model identities only; deployment/route fields never participate. */
export declare function modelNameDelta(previous: readonly string[], current: readonly string[]): ModelNameDelta;
/** Keep the original response envelope while limiting Core work to identities. */
export declare function responseForModelNames(response: unknown, names: ReadonlySet<string>): unknown;
/**
 * Merge a Core publication partition after processing only `processed` identities.
 * `retained` contains current identities whose prior Core result remains valid.
 */
export declare function mergePublicationResults(previous: PublicationResult | undefined, processed: PublicationResult | undefined, retained: ReadonlySet<string>): PublicationResult;
/** A selected-record miss among processed identities requires the latest catalog. */
export declare function needsCatalogRefresh(result: PublicationResult, processed: ReadonlySet<string>): boolean;
/**
 * Identify withheld models caused by an unavailable/degraded catalog. A complete
 * catalog with no matching record is a stable identity miss and is not retried by
 * an unchanged model set.
 */
export declare function temporaryMetadataFailureModelNames(result: PublicationResult, diagnostics: Pick<DiscoveryDiagnostics, "modelsDev">): string[];
/** Merge diagnostics without re-resolving retained model identities. */
export declare function mergeDiscoveryDiagnostics(previous: DiscoveryDiagnostics, changed: DiscoveryDiagnostics | undefined, response: unknown, currentNames: readonly string[], processed: ReadonlySet<string>): DiscoveryDiagnostics;
