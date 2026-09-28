const empty = { type: "object", properties: {}, additionalProperties: false } as const
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
} as const
const diagnostics = {
  type: "object",
  properties: {
    sequence: { type: "number" },
    sessionID: { type: "string" },
    lines: { type: "array", items: { type: "string" } },
  },
  required: ["sequence", "sessionID", "lines"],
  additionalProperties: false,
} as const

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
    latestDiagnostics: { input: empty, output: diagnostics },
  },
  events: {
    completed: { schema: result },
    diagnostics: { schema: diagnostics },
  },
} as const
