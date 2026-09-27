import type { Protocol } from "./generated/discovery-core/index.js";
export type { Protocol } from "./generated/discovery-core/index.js";
export interface PluginOptions {
    pollInterval: number;
    contextTierCap: boolean;
    protocolOverrides: Record<string, Protocol>;
    conversationFeedback: boolean;
}
export interface OptionLogger {
    warn(message: string): void;
}
export declare const DEFAULT_OPTIONS: PluginOptions;
export declare function parseOptions(input: unknown, logger?: OptionLogger): PluginOptions;
