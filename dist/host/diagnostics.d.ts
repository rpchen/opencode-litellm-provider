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
/**
 * Per-model canonical/serving/LKG facts (adopt-modelsdev-canonical-catalog).
 * Every new field is optional: older Core shapes omit them and the lines are
 * skipped, never fabricated. Local minimal shape keeps this renderer
 * independent of the generated Core version.
 */
interface ModelDiagnosticLike {
    readonly id: string;
    readonly deploymentCount?: number;
    readonly quality?: {
        readonly identity?: {
            readonly canonicalModelID?: string;
            readonly canonicalEvidence?: string;
            readonly canonicalStatus?: string;
        };
        readonly serving?: {
            readonly status?: string;
            readonly providerID?: string;
            readonly recordID?: string;
        };
        readonly reasoningLevelsState?: string;
        readonly operatorConfigurationKeys?: readonly string[];
        readonly diagnosticCandidates?: ReadonlyArray<{
            readonly providerID: string;
            readonly recordID: string;
        }>;
        readonly catalogKind?: string;
    };
    readonly publication?: {
        readonly reasoningLevels?: readonly string[];
    };
}
export declare function formatModelDetails(discovery: {
    readonly models?: readonly ModelDiagnosticLike[];
} | undefined, limit?: number): string[];
export declare function createDiagnosticsLines(snapshot: ProviderSnapshot, now?: number, timezoneOffsetMinutes?: number): string[];
export {};
