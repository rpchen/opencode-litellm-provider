import type { ProviderSnapshot } from "./register.js";
export declare function runtimeBuildInfo(): {
    pluginVersion: string;
    coreSHA: string;
    coreBranch: string;
};
export declare function createDiagnosticsLines(snapshot: ProviderSnapshot, now?: number): string[];
