import { type Protocol } from "./generated/discovery-core/index.js";
export type { Protocol } from "./generated/discovery-core/index.js";
export interface EndpointDefinition {
    readonly baseUrl: string;
    readonly protocolOverrides: Record<string, Protocol>;
}
export interface PluginOptions {
    pollInterval: number;
    contextTierCap: boolean;
    protocolOverrides: Record<string, Protocol>;
    conversationFeedback: boolean;
    /** Undefined means legacy single-endpoint mode using /connect URL configuration. */
    endpoints?: Readonly<Record<string, EndpointDefinition>>;
}
export interface OptionLogger {
    warn(message: string): void;
}
export declare const DEFAULT_OPTIONS: PluginOptions;
export declare function isEndpointId(value: string): boolean;
export declare function parseOptions(input: unknown, logger?: OptionLogger): PluginOptions;
