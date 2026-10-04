import type { ValidationState } from "./host/endpoint-state.js";
export declare const DEFAULT_ENDPOINT_ID = "default";
export declare const BASE_PLUGIN_ID = "litellm";
export interface EndpointIdentity {
    readonly id: string;
    readonly integrationId: string;
    readonly providerId: string;
    readonly displayName: string;
    /** Only set when validation.kind === "ok"; invalid endpoints never expose a fetchable URL. */
    readonly fixedBaseUrl?: string;
    readonly legacy: boolean;
    /** Endpoint definition validation, loaded from the declaring config file. */
    readonly validation: ValidationState;
}
export declare function endpointIdentity(id: string, fixedBaseUrl?: string, legacy?: boolean, validation?: ValidationState): EndpointIdentity;
export type EndpointActivation = {
    readonly mode: "all";
} | {
    readonly mode: "selected";
    readonly endpointIds: readonly string[];
};
export declare const ACTIVATION_STORAGE_KEY = "litellm.activation.v1";
export declare function activeEndpointIds(ids: readonly string[], activation: EndpointActivation): string[];
export declare function toggleEndpoint(ids: readonly string[], activation: EndpointActivation, id: string): EndpointActivation;
export declare function parseActivation(value: unknown): EndpointActivation;
