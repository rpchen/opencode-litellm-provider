const empty = { type: "object", properties: {}, additionalProperties: false };
const result = {
    type: "object",
    properties: {
        sequence: { type: "number" },
        sessionID: { type: "string" },
        ok: { type: "boolean" },
        path: { type: "string" },
        error: { type: "string" },
    },
    required: ["sequence", "sessionID", "ok", "path", "error"],
    additionalProperties: false,
};
export const auditRpc = {
    id: "litellm-audit-export",
    methods: {
        export: {
            input: {
                type: "object",
                properties: { sessionID: { type: "string" } },
                required: ["sessionID"],
                additionalProperties: false,
            },
            output: result,
        },
        latest: { input: empty, output: result },
    },
    events: { completed: { schema: result } },
};
