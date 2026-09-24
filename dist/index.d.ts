import { Plugin } from "@opencode/plugin";
import { type DiscoveryDependencies } from "./host/sync.js";
export declare const PLUGIN_ID = "litellm";
export declare function setupLiteLLM(context: Plugin.Context, dependencies?: DiscoveryDependencies): Promise<() => Promise<void>>;
declare const _default: Plugin.Plugin;
export default _default;
