export interface ParsedWireID {
    /** Original candidate value (trimmed). */
    readonly raw: string;
    /** Full value (always present). */
    readonly full: string;
    /** Bare value when the candidate has no `/`. */
    readonly bare?: string;
    /** Remainder after the adapter segment, only with parse evidence. */
    readonly afterAdapter?: string;
    /** Adapter segment that was stripped (parse metadata only). */
    readonly adapterSegment?: string;
    /** `custom_llm_provider` that provided the parse evidence, if any. */
    readonly customLLMProvider?: string;
    /** Ordered lookup keys: full -> afterAdapter (if any) -> bare (if any). */
    readonly lookupKeys: readonly string[];
}
/**
 * Parse one candidate value with its deployment's `custom_llm_provider`.
 * Returns `undefined` for empty values.
 */
export declare function parseWireID(candidate: string | undefined, customLLMProvider: string | undefined): ParsedWireID | undefined;
/**
 * Ordered deployment candidate values: `model_info.base_model` first, then
 * `litellm_params.model`. Each paired with the deployment's parse evidence.
 */
export declare function deploymentCandidates(deployment: {
    modelInfo: Record<string, unknown>;
    litellmParams: Record<string, unknown>;
}): Array<{
    value: string;
    customProvider: string | undefined;
    isBaseModel: boolean;
}>;
