export type Protocol = "chat" | "responses" | "messages";
export interface PluginOptions {
    pollInterval: number;
    contextTierCap: boolean;
    protocolOverrides: Record<string, Protocol>;
}
export interface OptionLogger {
    warn(message: string): void;
}
export declare const DEFAULT_OPTIONS: PluginOptions;
export declare function parseOptions(input: unknown, logger?: OptionLogger): PluginOptions;
