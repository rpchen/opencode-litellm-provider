export interface RuntimeIdentity {
    pluginVersion: string;
    artifactDigest: string;
    coreCommit: string;
}
export declare class RuntimeIdentityError extends Error {
    constructor(message: string);
}
export declare function isValidPluginVersion(value: unknown): value is string;
export declare function isValidArtifactDigest(value: unknown): value is string;
export declare function isValidCoreCommit(value: unknown): value is string;
export declare function parseRuntimeIdentity(value: unknown): RuntimeIdentity;
export declare function getRuntimeIdentity(): RuntimeIdentity;
export declare function loadRuntimeIdentityStrict(): RuntimeIdentity;
export declare function resetRuntimeIdentityForTests(): void;
export declare function setRuntimeIdentityForTests(identity: RuntimeIdentity): void;
export declare function shortArtifactDigest(identity: RuntimeIdentity): string;
export declare function shortCoreCommit(identity: RuntimeIdentity): string;
export declare function formatStartupIdentityLine(identity: RuntimeIdentity): string;
