import type { ProviderSnapshot } from "./register.js";
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
export declare function createDiagnosticsLines(snapshot: ProviderSnapshot, now?: number, timezoneOffsetMinutes?: number): string[];
