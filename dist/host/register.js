import { Model, Provider } from "@opencode/plugin";
import { PROTOCOL_PACKAGES } from "../core/protocol.js";
export const INTEGRATION_ID = "litellm";
export const PROVIDER_ID = "litellm";
export function applyIntegration(editor) {
    editor.update(INTEGRATION_ID, (integration) => {
        integration.name = "LiteLLM";
    });
    editor.method.update({
        integrationID: INTEGRATION_ID,
        method: {
            type: "key",
            label: "API Key",
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
        },
    });
}
function toModelInfo(spec) {
    const providerID = PROVIDER_ID;
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
export function applyProvider(editor, snapshot) {
    if (!snapshot.ready || !snapshot.connection || !snapshot.apiBaseURL)
        return;
    editor.add({
        info: {
            ...Provider.Info.empty(PROVIDER_ID),
            id: PROVIDER_ID,
            integrationID: INTEGRATION_ID,
            name: "LiteLLM",
            activation: "auto",
            package: PROTOCOL_PACKAGES.chat,
            settings: { baseURL: snapshot.apiBaseURL },
        },
        models: snapshot.models.map(toModelInfo),
        sourceConnection: snapshot.connection,
    });
}
export function registerIntegration(context) {
    return context.integration.transform((editor) => applyIntegration(editor));
}
export function registerProvider(context, snapshot) {
    return context.provider.transform((editor) => applyProvider(editor, snapshot));
}
