/**
 * Server-side endpoint management behind `/litellm-endpoints`: Add / Edit / Delete against the OpenCode
 * config file that declares this plugin, plus the legacy → explicit migration. Credentials are handled by
 * the TUI through the host's own client API (keys never pass through this plugin's RPC). See design.md.
 */
import type { EndpointActivation } from "../endpoints.js";
import { type PluginOptions } from "../options.js";
import { type ConfigTarget } from "./config-file.js";
import type { EndpointManagement } from "./endpoint-command.js";
export interface ManagerHost {
    env: Record<string, string | undefined>;
    options(): PluginOptions;
    ids(): string[];
    activation(): EndpointActivation;
    /** Persist activation and reconcile the running runtime immediately. */
    setActivation(next: EndpointActivation): Promise<void>;
    /** Dispose the running runtime and rebuild it from `next`. */
    rebuild(next: PluginOptions): Promise<void>;
    /** Address stored with the active legacy `litellm` connection, if any. */
    legacyBaseUrl(): Promise<string | undefined>;
    removeStorage(key: string): Promise<void>;
    sourceTarget(): Promise<string | undefined>;
    /** Test seam for the config writer. */
    write?: {
        rename?: (from: string, to: string) => void;
        beforeCommit?: () => void;
    };
    /** Injected config file (tests); production locates it from env + host plugin source. */
    target?: ConfigTarget;
}
export declare function createEndpointManagement(host: ManagerHost): EndpointManagement;
