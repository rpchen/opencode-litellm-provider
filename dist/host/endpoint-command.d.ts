import type { Plugin } from "@opencode/plugin";
import type { EndpointActivation } from "../endpoints.js";
import type { Registration } from "./register.js";
export interface EndpointActivationView {
    sequence: number;
    sessionID: string;
    mode: "all" | "selected";
    endpointIds: string[];
    activeEndpointIds: string[];
}
export declare function registerEndpointActivation(context: Pick<Plugin.Context, "rpc" | "command">, endpointIds: readonly string[], read: () => EndpointActivation, apply: (next: EndpointActivation) => Promise<void>): Promise<Registration>;
