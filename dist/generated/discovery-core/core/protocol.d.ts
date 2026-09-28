/**
 * Host-independent protocol resolution. Host SDK package mapping belongs to plugin adapters.
 */
import { type DeploymentGroup, type LiteLLMDeployment } from "./litellm.js";
/** LiteLLM call protocol chosen for a model. */
export type Protocol = "chat" | "responses" | "messages";
/** Protocol capability independent from the protocol currently selected by Core. */
export type ProtocolSupport = "chat" | "responses" | "both" | "messages" | "unknown";
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
export declare function deploymentProtocolSupport(deployment: LiteLLMDeployment): ProtocolSupport;
export declare function resolveProtocolSupport(group: DeploymentGroup): ProtocolSupport;
export declare function deploymentProtocolResolution(deployment: LiteLLMDeployment): DeploymentProtocolResolution;
export declare function deploymentProtocol(deployment: LiteLLMDeployment): Protocol;
export declare function resolveProtocolResolution(group: DeploymentGroup, overrides?: Readonly<Record<string, Protocol>>): ProtocolResolution;
export declare function resolveProtocol(group: DeploymentGroup, overrides?: Readonly<Record<string, Protocol>>): Protocol;
