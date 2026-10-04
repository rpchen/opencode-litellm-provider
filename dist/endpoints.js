export const DEFAULT_ENDPOINT_ID = "default";
export const BASE_PLUGIN_ID = "litellm";
export function endpointIdentity(id, fixedBaseUrl, legacy = false, validation = { kind: "ok" }) {
    const providerId = id === DEFAULT_ENDPOINT_ID ? BASE_PLUGIN_ID : `${BASE_PLUGIN_ID}-${id}`;
    return {
        id,
        integrationId: providerId,
        providerId,
        displayName: id === DEFAULT_ENDPOINT_ID ? "LiteLLM" : `LiteLLM · ${id}`,
        fixedBaseUrl: validation.kind === "ok" ? fixedBaseUrl : undefined,
        legacy,
        validation,
    };
}
export const ACTIVATION_STORAGE_KEY = "litellm.activation.v1";
export function activeEndpointIds(ids, activation) {
    if (activation.mode === "all")
        return [...ids];
    const selected = new Set(activation.endpointIds);
    return ids.filter((id) => selected.has(id));
}
export function toggleEndpoint(ids, activation, id) {
    const selected = new Set(activation.mode === "all" ? ids : activation.endpointIds);
    if (selected.has(id))
        selected.delete(id);
    else
        selected.add(id);
    return { mode: "selected", endpointIds: [...selected] };
}
export function parseActivation(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return { mode: "all" };
    const record = value;
    if (record.mode === "all")
        return { mode: "all" };
    if (record.mode === "selected" &&
        Array.isArray(record.endpointIds) &&
        record.endpointIds.every((id) => typeof id === "string")) {
        return { mode: "selected", endpointIds: [...new Set(record.endpointIds)] };
    }
    return { mode: "all" };
}
