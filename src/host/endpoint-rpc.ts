const state = {
  type: "object",
  properties: {
    sequence: { type: "number" },
    sessionID: { type: "string" },
    mode: { type: "string", enum: ["all", "selected"] },
    endpointIds: { type: "array", items: { type: "string" } },
    activeEndpointIds: { type: "array", items: { type: "string" } },
  },
  required: ["sequence", "sessionID", "mode", "endpointIds", "activeEndpointIds"],
  additionalProperties: false,
} as const

export const endpointRpc = {
  id: "litellm-endpoints",
  methods: {
    state: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: state,
    },
    set: {
      input: {
        type: "object",
        properties: {
          action: { type: "string" },
          endpointId: { type: "string" },
        },
        required: ["action", "endpointId"],
        additionalProperties: false,
      },
      output: state,
    },
  },
  events: {
    shown: { schema: state },
  },
} as const
