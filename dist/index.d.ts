import { Plugin } from "@opencode/plugin";
import { type ManagerHost } from "./host/endpoint-manager.js";
import { type DiscoveryDependencies } from "./host/sync.js";
export declare const PLUGIN_ID = "litellm";
export declare function setupLiteLLM(rawContext: Plugin.Context, dependencies?: DiscoveryDependencies, internals?: {
    management?: Partial<ManagerHost>;
}): Promise<() => Promise<void>>;
declare const _default: Plugin.Plugin;
export default _default;
