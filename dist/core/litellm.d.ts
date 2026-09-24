export interface LiteLLMAddresses {
    rootURL: string;
    apiBaseURL: string;
    modelInfoURL: string;
    legacyModelInfoURL: string;
}
export interface LiteLLMDeployment {
    modelName: string;
    litellmParams: Record<string, unknown>;
    modelInfo: Record<string, unknown>;
    sourceIndex: number;
}
export interface DeploymentGroup {
    modelName: string;
    deployments: LiteLLMDeployment[];
}
export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare function optionalString(value: unknown): string | undefined;
export declare function optionalBoolean(value: unknown): boolean | undefined;
export declare function optionalNumber(value: unknown): number | undefined;
export declare function positiveInteger(value: unknown): number | undefined;
export declare function stripRoutePrefix(model: string): string;
export declare function normalizeLiteLLMURL(input: string): LiteLLMAddresses;
export declare function groupLiteLLMDeployments(input: unknown): DeploymentGroup[];
