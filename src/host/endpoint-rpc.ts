const endpointView = {
  type: "object",
  properties: {
    id: { type: "string" },
    baseUrl: { type: "string" },
    active: { type: "boolean" },
    legacy: { type: "boolean" },
    state: {
      type: "object",
      properties: {
        endpointId: { type: "string" },
        desired: { type: "string", enum: ["enabled", "disabled"] },
        validation: {
          type: "object",
          properties: { kind: { type: "string", enum: ["ok", "invalid"] }, reason: { type: "string" } },
          required: ["kind"],
          additionalProperties: false,
        },
        credential: { type: "string", enum: ["stored", "environment", "none", "unknown"] },
        applied: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["active", "not-applied", "error"] },
            lastDiscoveryAt: { type: "string" },
            modelCount: { type: "number" },
            category: { type: "string" },
            message: { type: "string" },
            at: { type: "string" },
          },
          required: ["kind"],
          additionalProperties: false,
        },
      },
      required: ["endpointId", "desired", "validation", "credential", "applied"],
      additionalProperties: false,
    },
    status: { type: "string" },
    statusLabel: { type: "string" },
    canRetry: { type: "boolean" },
  },
  required: ["id", "baseUrl", "active", "legacy"],
  additionalProperties: false,
} as const

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
} as const

const result = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    code: { type: "string" },
    message: { type: "string" },
    migrated: { type: "boolean" },
    /** The config mutation is persisted even though the operation failed (post-commit reload failure). */
    saved: { type: "boolean" },
    state,
  },
  required: ["ok", "state"],
  additionalProperties: false,
} as const

const noInput = { type: "object", properties: {}, additionalProperties: false } as const
const idInput = {
  type: "object",
  properties: { endpointId: { type: "string" } },
  required: ["endpointId"],
  additionalProperties: false,
} as const

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
    /** Legacy single-endpoint → explicit `options.endpoints.default`; identity and credential stay unchanged. */
    migrate: { input: noInput, output: result },
    /** Retry / 重新应用: force a forced refresh for one endpoint. */
    trigger: { input: idInput, output: result },
  },
  events: {
    shown: { schema: state },
  },
} as const
