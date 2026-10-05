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
const withheldReason = {
    type: "object",
    properties: {
        code: { type: "string" },
        message: { type: "string" },
        fields: { type: "array", items: { type: "string" } },
    },
    required: ["code", "message", "fields"],
    additionalProperties: false,
};
const withheldModel = {
    type: "object",
    properties: {
        id: { type: "string" },
        status: { type: "string" },
        reasons: { type: "array", items: withheldReason },
        previouslyPublished: { type: "boolean" },
        retryable: { type: "boolean" },
    },
    required: ["id", "status", "reasons", "previouslyPublished", "retryable"],
    additionalProperties: false,
};
const fieldFact = {
    type: "object",
    properties: {
        model: { type: "string" },
        field: { type: "string" },
        status: { type: "string" },
        resolution: { type: "string" },
    },
    required: ["model", "field", "status", "resolution"],
    additionalProperties: false,
};
const summary = {
    type: "object",
    properties: {
        discovered: { type: "number" },
        publishable: { type: "array", items: modelState },
        lkgIDs: { type: "array", items: { type: "string" } },
        lkgDetail: { type: "string" },
        withheld: { type: "array", items: withheldModel },
        partial: { type: "boolean" },
        unusable: { type: "boolean" },
        regressions: { type: "array", items: { type: "string" } },
        discrepancies: { type: "array", items: fieldFact },
        conflicts: { type: "array", items: fieldFact },
        failureKind: { type: "string" },
    },
    required: ["discovered", "publishable", "lkgIDs", "withheld", "partial", "unusable", "regressions"],
    additionalProperties: false,
};
/**
 * Read-only publication state surface.
 *
 * There is intentionally no acceptance/override method: publication is
 * decided by Core alone and never by a client action.
 */
export const publicationRpc = {
    id: "litellm-publication",
    methods: {
        state: { input: empty, output: summary },
    },
    events: {},
};
