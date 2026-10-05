import type { ProviderSnapshot } from "./register.js";
import type { PublicationSummary } from "./publication.js";
export declare function runtimeBuildInfo(): {
    pluginVersion: string;
    coreSHA: string;
    coreBranch: string;
};
/**
 * Format an instant in the timezone configured on the running OpenCode host.
 * The optional offset exists only for deterministic tests.
 */
export declare function formatHostDateTime(value: string | number | Date, timezoneOffsetMinutes?: number): string;
/** Render the Core publication partition: availability, withheld reasons, LKG, evidence. */
export declare function formatPublicationLines(summary: PublicationSummary | undefined): string[];
export declare function createDiagnosticsLines(snapshot: ProviderSnapshot, now?: number, timezoneOffsetMinutes?: number): string[];
