import { type BuildOptions, type ModelSpec } from "./build.js";
export declare const DISCOVERY_SNAPSHOT_SCHEMA_VERSION: 1;
export interface EndpointFingerprintInput {
    readonly baseUrl: string;
    readonly credentialKey: string;
    readonly buildOptions?: Pick<BuildOptions, "contextTierCap" | "protocolOverrides">;
}
export interface DiscoverySnapshot {
    readonly schemaVersion: typeof DISCOVERY_SNAPSHOT_SCHEMA_VERSION;
    readonly endpointFingerprint: string;
    readonly discoveredAt: string;
    readonly modelFingerprint: string;
    readonly models: ModelSpec[];
}
export type DiscoverySnapshotCompatibilityReason = "compatible" | "missing" | "invalid" | "schema-version" | "endpoint" | "corrupt";
export interface DiscoverySnapshotCompatibility {
    readonly compatible: boolean;
    readonly reason: DiscoverySnapshotCompatibilityReason;
    readonly snapshot?: DiscoverySnapshot;
}
export interface DiscoverySnapshotDiff {
    readonly changed: boolean;
    readonly drift: boolean;
    readonly endpointChanged: boolean;
    readonly added: readonly string[];
    readonly removed: readonly string[];
    readonly protocolChanged: readonly string[];
    readonly capabilityChanged: readonly string[];
    readonly metadataChanged: readonly string[];
}
export declare function endpointFingerprint(input: EndpointFingerprintInput): string;
export declare function createDiscoverySnapshot(endpoint: string, models: readonly ModelSpec[], discoveredAt?: string): DiscoverySnapshot;
export declare function inspectDiscoverySnapshot(value: unknown, expectedEndpointFingerprint: string): DiscoverySnapshotCompatibility;
export declare function compareDiscoverySnapshots(previous: DiscoverySnapshot, current: DiscoverySnapshot): DiscoverySnapshotDiff;
