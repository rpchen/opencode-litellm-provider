const empty = { type: "object", properties: {}, additionalProperties: false } as const

const modelState = {
  type: "object",
  properties: {
    id: { type: "string" },
    status: { type: "string" },
  },
  required: ["id", "status"],
  additionalProperties: false,
} as const

const blockedModel = {
  type: "object",
  properties: {
    id: { type: "string" },
    status: { type: "string" },
    gaps: { type: "array", items: { type: "string" } },
  },
  required: ["id", "status", "gaps"],
  additionalProperties: false,
} as const

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
} as const

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
} as const

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
} as const

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
} as const
