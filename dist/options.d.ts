import { type Protocol } from "./generated/discovery-core/index.js";
import type { ValidationState } from "./host/endpoint-state.js";
export type { Protocol } from "./generated/discovery-core/index.js";
export interface EndpointDefinition {
    /** Raw user-provided baseUrl. Empty when invalid. */
    readonly baseUrl: string;
    readonly protocolOverrides: Record<string, Protocol>;
    /**
     * Endpoint definition validation. When absent (legacy callers/tests), the effective
     * value is `{ kind: "ok" }`. Runtime apply refuses the endpoint when `kind === "invalid"`.
     */
    readonly validation?: ValidationState;
    /** The raw user value when validation failed (kept for diagnostics). */
    readonly invalidBaseUrl?: string;
}
export interface PluginOptions {
    pollInterval: number;
    contextTierCap: boolean;
    protocolOverrides: Record<string, Protocol>;
    conversationFeedback: boolean;
    /**
     * Optional override for the models.dev catalog URL (default
     * `https://models.dev/api.json`). Lets an operator point at a self-hosted or
     * mirrored catalog; the fetched document goes through exactly the same
     * evidence and publication policy as the default source.
     */
    modelsDevUrl?: string;
    /** Undefined means legacy single-endpoint mode using /connect URL caching. */
    endpoints?: Readonly<Record<string, EndpointDefinition>>;
}
export interface OptionLogger {
    warn(message: string): void;
}
export declare const DEFAULT_OPTIONS: PluginOptions;
export declare function isEndpointId(value: string): boolean;
export declare function parseOptions(input: unknown, logger?: OptionLogger): PluginOptions;
