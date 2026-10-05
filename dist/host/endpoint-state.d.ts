/**
 * Canonical endpoint state model: desired × validation × credential × applied.
 *
 * Pure module — no OpenCode imports. Every user-visible surface (management list,
 * endpoint detail, /litellm-diagnostics, /models publishing) derives from the same
 * `userVisibleStatus(state)` so no view can drift from runtime truth.
 *
 * Tokens and labels are shared verbatim with the Pi adapter so both plugins tell
 * the user exactly the same story.
 */
export type DesiredState = "enabled" | "disabled";
export type ValidationState = {
    readonly kind: "ok";
} | {
    readonly kind: "invalid";
    readonly reason: string;
};
export type CredentialState = "stored" | "environment" | "none" | "unknown";
export type ApplyErrorCategory = "credential-missing" | "config-invalid" | "auth" | "network" | "parse" | "cancelled";
export type AppliedState = {
    readonly kind: "active";
    readonly lastDiscoveryAt?: string;
    readonly modelCount: number;
} | {
    readonly kind: "not-applied";
} | {
    readonly kind: "error";
    readonly category: ApplyErrorCategory;
    readonly message?: string;
    readonly at?: string;
};
export interface EndpointState {
    readonly endpointId: string;
    readonly desired: DesiredState;
    readonly validation: ValidationState;
    readonly credential: CredentialState;
    readonly applied: AppliedState;
}
export type UserVisibleStatus = "disabled" | "disabled-invalid" | "enabled-active" | "enabled-needs-authentication" | "enabled-not-applied" | "enabled-error" | "enabled-invalid-configuration";
export declare function userVisibleStatus(state: EndpointState): UserVisibleStatus;
export declare function statusLabel(status: UserVisibleStatus): string;
export declare function credentialLabel(state: CredentialState): string;
export declare function applyErrorLabel(category: ApplyErrorCategory): string;
/**
 * Frozen `/models` predicate: only endpoints that are enabled, valid, credentialed
 * and have at least one successful refresh in this process MAY publish models.
 */
export declare function canPublish(state: EndpointState): boolean;
/** Whether Retry / 重新应用 is offered for this state. */
export declare function canRetry(state: EndpointState): boolean;
export declare const INITIAL_APPLIED: AppliedState;
export declare function initialEndpointState(endpointId: string, desired: DesiredState, validation: ValidationState, credential: CredentialState): EndpointState;
