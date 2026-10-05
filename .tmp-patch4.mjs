import fs from "node:fs"

function patch(path, pairs) {
  let s = fs.readFileSync(path, "utf8")
  for (const [oldText, newText] of pairs) {
    if (!s.includes(oldText)) throw new Error(`${path}: missing >>> ${oldText.slice(0, 90)}`)
    s = s.replace(oldText, newText)
  }
  fs.writeFileSync(path, s)
  console.log("patched", path)
}

// --- publication-rpc.ts: no model-level acceptance RPC at all -----------------
const rpc = "src/host/publication-rpc.ts"
const rpcSource = fs.readFileSync(rpc, "utf8")
const head = rpcSource.slice(0, rpcSource.indexOf("const blockedModel = {"))
const newBody = `const withheldReason = {
  type: "object",
  properties: {
    code: { type: "string" },
    message: { type: "string" },
    fields: { type: "array", items: { type: "string" } },
  },
  required: ["code", "message", "fields"],
  additionalProperties: false,
} as const

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
} as const

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
} as const

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
} as const

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
} as const
`
fs.writeFileSync(rpc, head + newBody)
console.log("rewrote", rpc)

// --- audit-command.ts --------------------------------------------------------
patch("src/host/audit-command.ts", [
  [
    `import {
  acceptDegradedForSnapshot,
`,
    `import {
`,
  ],
  [
    `  const publication = await context.rpc.register(publicationRpc, {
    async state() {
      return snapshot.diagnostics?.publication ?? { publishable: [], degradedIDs: [], lkgIDs: [], blocked: [] }
    },
    async accept(input: unknown) {
      const { sessionID, modelId } = input as { sessionID: string; modelId: string }
      const outcome = acceptDegradedForSnapshot(snapshot, modelId)
      await publication.events.emit("accepted", {
        sessionID,
        modelId,
        ok: outcome.accepted,
        status: outcome.status ?? "",
        gaps: [...(outcome.gaps ?? [])],
        reason: outcome.reason ?? (outcome.accepted ? "degraded-accepted" : "rejected"),
      })
      latest = {
        sequence: ++diagnosticSequence,
        sessionID,
        ok: outcome.accepted,
        path: "",
        error: outcome.accepted ? "" : (outcome.reason ?? "rejected"),
        lines: createDiagnosticsLines(snapshot),
      }
      await rpc.events.emit("completed", latest)
      return {
        ok: outcome.accepted,
        status: outcome.status ?? "",
        gaps: [...(outcome.gaps ?? [])],
        reason: outcome.reason ?? (outcome.accepted ? "degraded-accepted" : "rejected"),
      }
    },
  })`,
    `  const publication = await context.rpc.register(publicationRpc, {
    async state() {
      return snapshot.diagnostics?.publication ?? {
        discovered: 0,
        publishable: [],
        lkgIDs: [],
        withheld: [],
        partial: false,
        unusable: false,
        regressions: [],
        discrepancies: [],
        conflicts: [],
      }
    },
  })`,
  ],
  [
    `      editor.add({
        name: "litellm-accept-degraded",
        description: "显式接受某个未完成模型的降级配置（仍标记为降级，下次刷新生效）",
        async execute(input) {
          const record = input as { sessionID: string }
          const [modelId] = splitAcceptArgs(readAcceptText(input)).slice(-1)
          const outcome = modelId
            ? acceptDegradedForSnapshot(snapshot, modelId)
            : { accepted: false as const, reason: "usage" }
          await publication.events.emit("accepted", {
            sessionID: record.sessionID,
            modelId: modelId ?? "",
            ok: outcome.accepted,
            status: outcome.status ?? "",
            gaps: [...(outcome.gaps ?? [])],
            reason: outcome.reason ?? (outcome.accepted ? "degraded-accepted" : "rejected"),
          })
          latest = {
            sequence: ++diagnosticSequence,
            sessionID: record.sessionID,
            ok: outcome.accepted,
            path: "",
            error: outcome.accepted ? "" : (outcome.reason ?? "rejected"),
            lines: createDiagnosticsLines(snapshot),
          }
          await rpc.events.emit("completed", latest)
        },
      })
`,
    ``,
  ],
])

// --- multi-audit-command.ts --------------------------------------------------
patch("src/host/multi-audit-command.ts", [
  [
    `import {
  acceptDegradedForSnapshot,
`,
    `import {
`,
  ],
])
