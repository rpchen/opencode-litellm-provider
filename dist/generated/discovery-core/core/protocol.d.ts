/**
 * Host-independent protocol resolution. Host SDK package mapping belongs to plugin adapters.
 */
import { type DeploymentGroup, type LiteLLMDeployment } from "./litellm.js";
/** LiteLLM call protocol chosen for a model. */
export type Protocol = "chat" | "responses" | "messages";
export declare function deploymentProtocol(deployment: LiteLLMDeployment): Protocol;
export declare function resolveProtocol(group: DeploymentGroup, overrides?: Readonly<Record<string, Protocol>>): Protocol;
