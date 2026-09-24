import type { Protocol } from "../options.js";
import { type DeploymentGroup, type LiteLLMDeployment } from "./litellm.js";
export declare const PROTOCOL_PACKAGES: Record<Protocol, string>;
export declare function deploymentProtocol(deployment: LiteLLMDeployment): Protocol;
export declare function resolveProtocol(group: DeploymentGroup, overrides?: Readonly<Record<string, Protocol>>): Protocol;
