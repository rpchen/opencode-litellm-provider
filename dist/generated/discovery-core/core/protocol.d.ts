/**
 * Host-independent protocol resolution. Host SDK package mapping belongs to plugin adapters.
 */
import { type DeploymentGroup, type LiteLLMDeployment } from "./litellm.js";
/** LiteLLM call protocol chosen for a model. */
export type Protocol = "chat" | "responses" | "messages";
export type ProtocolReason = "override" | "anthropic" | "supported-endpoints" | "mode" | "fallback" | "mixed-fallback";
export interface DeploymentProtocolResolution {
    readonly protocol: Protocol;
    readonly reason: Exclude<ProtocolReason, "override" | "mixed-fallback">;
}
export interface ProtocolResolution {
    readonly protocol: Protocol;
    readonly reason: ProtocolReason;
    readonly deployments: readonly DeploymentProtocolResolution[];
}
export declare function deploymentProtocolResolution(deployment: LiteLLMDeployment): DeploymentProtocolResolution;
export declare function deploymentProtocol(deployment: LiteLLMDeployment): Protocol;
export declare function resolveProtocolResolution(group: DeploymentGroup, overrides?: Readonly<Record<string, Protocol>>): ProtocolResolution;
export declare function resolveProtocol(group: DeploymentGroup, overrides?: Readonly<Record<string, Protocol>>): Protocol;
