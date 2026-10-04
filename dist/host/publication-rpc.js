const empty = { type: "object", properties: {}, additionalProperties: false };
const modelState = {
    type: "object",
    properties: {
        id: { type: "string" },
        status: { type: "string" },
    },
    required: ["id", "status"],
    additionalProperties: false,
};
const blockedModel = {
    type: "object",
    properties: {
        id: { type: "string" },
        status: { type: "string" },
        gaps: { type: "array", items: { type: "string" } },
        degradationEligible: { type: "boolean" },
        degradationReason: { type: "string" },
    },
    required: ["id", "status", "gaps", "degradationEligible"],
    additionalProperties: false,
};
const summary = {
    type: "object",
    properties: {
        publishable: { type: "array", items: modelState },
        degradedIDs: { type: "array", items: { type: "string" } },
        lkgIDs: { type: "array", items: { type: "string" } },
        blocked: { type: "array", items: blockedModel },
    },
    required: ["publishable", "degradedIDs", "lkgIDs", "blocked"],
    additionalProperties: false,
};
const acceptResult = {
    type: "object",
    properties: {
        ok: { type: "boolean" },
        status: { type: "string" },
        gaps: { type: "array", items: { type: "string" } },
        reason: { type: "string" },
    },
    required: ["ok", "status", "gaps", "reason"],
    additionalProperties: false,
};
const accepted = {
    type: "object",
    properties: {
        sessionID: { type: "string" },
        modelId: { type: "string" },
        ok: { type: "boolean" },
        status: { type: "string" },
        gaps: { type: "array", items: { type: "string" } },
        reason: { type: "string" },
    },
    required: ["sessionID", "modelId", "ok", "status", "gaps", "reason"],
    additionalProperties: false,
};
export const publicationRpc = {
    id: "litellm-publication",
    methods: {
        state: { input: empty, output: summary },
        accept: {
            input: {
                type: "object",
                properties: {
                    sessionID: { type: "string" },
                    modelId: { type: "string" },
                    endpointId: { type: "string" },
                },
                required: ["sessionID", "modelId"],
                additionalProperties: false,
            },
            output: acceptResult,
        },
    },
    events: { accepted: { schema: accepted } },
};
