const endpointView = {
    type: "object",
    properties: {
        id: { type: "string" },
        baseUrl: { type: "string" },
        active: { type: "boolean" },
        legacy: { type: "boolean" },
    },
    required: ["id", "baseUrl", "active", "legacy"],
    additionalProperties: false,
};
const state = {
    type: "object",
    properties: {
        sequence: { type: "number" },
        sessionID: { type: "string" },
        mode: { type: "string", enum: ["all", "selected"] },
        endpointIds: { type: "array", items: { type: "string" } },
        activeEndpointIds: { type: "array", items: { type: "string" } },
        endpoints: { type: "array", items: endpointView },
        /** Whether Add / Edit / Delete can write the config file that declares this plugin. */
        writable: { type: "boolean" },
        /** Human-readable reason when `writable` is false. */
        configProblem: { type: "string" },
        /** Legacy single-endpoint mode: Add needs a migration confirmation first. */
        legacyMigration: { type: "boolean" },
    },
    required: ["sequence", "sessionID", "mode", "endpointIds", "activeEndpointIds"],
    additionalProperties: false,
};
const result = {
    type: "object",
    properties: {
        ok: { type: "boolean" },
        code: { type: "string" },
        message: { type: "string" },
        migrated: { type: "boolean" },
        state,
    },
    required: ["ok", "state"],
    additionalProperties: false,
};
const noInput = { type: "object", properties: {}, additionalProperties: false };
const idInput = {
    type: "object",
    properties: { endpointId: { type: "string" } },
    required: ["endpointId"],
    additionalProperties: false,
};
export const endpointRpc = {
    id: "litellm-endpoints",
    methods: {
        state: { input: noInput, output: state },
        set: {
            input: {
                type: "object",
                properties: { action: { type: "string" }, endpointId: { type: "string" } },
                required: ["action", "endpointId"],
                additionalProperties: false,
            },
            output: state,
        },
        add: {
            input: {
                type: "object",
                properties: { endpointId: { type: "string" }, baseUrl: { type: "string" }, confirmMigration: { type: "boolean" } },
                required: ["endpointId", "baseUrl"],
                additionalProperties: false,
            },
            output: result,
        },
        edit: {
            input: {
                type: "object",
                properties: { endpointId: { type: "string" }, baseUrl: { type: "string" } },
                required: ["endpointId", "baseUrl"],
                additionalProperties: false,
            },
            output: result,
        },
        /** Step 1 of Delete: stop the runtime and clear server-held state; the definition is kept. */
        prepareRemove: { input: idInput, output: result },
        /** Step 2 of Delete: remove the definition (after the client removed the credentials). */
        remove: { input: idInput, output: result },
    },
    events: {
        shown: { schema: state },
    },
};
