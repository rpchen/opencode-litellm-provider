import { Model, Provider } from "@opencode/plugin";
import { PROTOCOL_PACKAGES } from "../core/protocol.js";
import { endpointIdentity } from "../endpoints.js";
export const INTEGRATION_ID = "litellm";
export const PROVIDER_ID = "litellm";
const DEFAULT_IDENTITY = endpointIdentity("default", undefined, true);
export function applyIntegration(editor, endpoint = DEFAULT_IDENTITY) {
    editor.update(endpoint.integrationId, (integration) => {
        integration.name = endpoint.displayName;
    });
    editor.method.update({
        integrationID: endpoint.integrationId,
        method: {
            type: "key",
            label: "API Key",
            ...(endpoint.fixedBaseUrl ? {} : {
                form: [
                    {
                        key: "url",
                        type: "string",
                        format: "uri",
                        required: true,
                        title: "LiteLLM 地址",
                        placeholder: "http://litellm.example:4000",
                    },
                ],
            }),
        },
    });
}
function toModelInfo(spec, endpoint) {
    const providerID = endpoint.providerId;
    const modelID = spec.id;
    return {
        ...Model.Info.default(providerID, modelID),
        id: modelID,
        modelID,
        providerID,
        name: spec.name,
        package: spec.package,
        capabilities: spec.capabilities,
        variants: spec.variants.map((variant) => ({
            id: variant.id,
            settings: variant.settings,
        })),
        time: { released: spec.released },
        cost: [
            {
                input: spec.cost.input,
                output: spec.cost.output,
                cache: { read: spec.cost.cacheRead, write: spec.cost.cacheWrite },
            },
        ],
        status: "active",
        enabled: true,
        limit: spec.limit,
    };
}
function freezeDeep(value, seen = new WeakSet()) {
    if (typeof value !== "object" || value === null || seen.has(value))
        return value;
    seen.add(value);
    for (const item of Object.values(value))
        freezeDeep(item, seen);
    return Object.freeze(value);
}
export function createRegistrationView(models, apiBaseURL, endpoint = DEFAULT_IDENTITY) {
    const specs = structuredClone(models);
    const protocols = Object.fromEntries(specs.map((spec) => [spec.id, spec.protocol]));
    const releaseUnits = Object.fromEntries(specs.map((spec) => [
        spec.id,
        spec.releaseUnit ?? (spec.released === 0 ? "none" : "unknown"),
    ]));
    return freezeDeep({
        info: {
            ...Provider.Info.empty(endpoint.providerId),
            id: endpoint.providerId,
            integrationID: endpoint.integrationId,
            name: endpoint.displayName,
            activation: "auto",
            package: PROTOCOL_PACKAGES.chat,
            settings: { baseURL: apiBaseURL },
        },
        models: specs.map((spec) => toModelInfo(spec, endpoint)),
        protocols,
        releaseUnits,
    });
}
export function applyProvider(editor, snapshot, endpoint = DEFAULT_IDENTITY) {
    if (!snapshot.ready || !snapshot.connection || !snapshot.apiBaseURL)
        return;
    const view = snapshot.registrationView ?? snapshot.audit?.view ?? createRegistrationView(snapshot.models, snapshot.apiBaseURL, endpoint);
    editor.add({
        info: view.info,
        models: view.models,
        sourceConnection: snapshot.connection,
    });
}
export function registerIntegration(context, endpoint = DEFAULT_IDENTITY) {
    return context.integration.transform((editor) => applyIntegration(editor, endpoint));
}
export function registerIntegrations(context, endpoints) {
    return context.integration.transform((editor) => {
        for (const endpoint of endpoints)
            applyIntegration(editor, endpoint);
    });
}
export function registerProvider(context, snapshot, endpoint = DEFAULT_IDENTITY) {
    return context.provider.transform((editor) => applyProvider(editor, snapshot, endpoint));
}
