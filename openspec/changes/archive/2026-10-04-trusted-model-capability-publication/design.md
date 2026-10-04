# Design (OpenCode adapter)

## Architecture

- `src/host/models.ts` gains entry-based mapping:
  `toOpenCodeModelSpecWithPublication(entry)` maps the spec and
  overrides `capabilities.tools` through Core `hostToolsFlag`
  (`unknown` → disabled); `buildPublicationModels(response, catalog,
  options, pubOpts)` wraps Core `buildPublicationResult` and applies
  the operational-limits guard. Legacy `buildModelSpecs` stays for the
  sync test seam and wire compatibility.
- `src/host/publication.ts` (new, adapter-side only): snapshot-anchored
  `PublicationState` (LKG store + accepted-degraded set, created once
  per ProviderSnapshot and reused across refreshes),
  `PublicationSummary` (adapter-visible slice of the Core partition),
  `summarizePublication`, and `acceptDegradedForSnapshot` (validates
  blocked membership, records acceptance, returns gaps; never
  re-labels as configured).
- `src/host/sync.ts`: the default discovery path (no injected
  `buildModels`) uses `buildPublicationModels` with the snapshot's
  publication state; catalog fetch failures are classified with Core
  taxonomy into the partition input; configured models seed LKG;
  `snapshot.diagnostics.publication` carries the summary; the persisted
  snapshot holds publishable non-degraded specs only. The injected
  `buildModels` seam keeps legacy behavior for sync-mechanics tests.
- `src/host/register.ts`: `ProviderSnapshot` gains optional
  `publication` (summary) and `publicationState` (controller); mapping
  itself is unchanged (tools override happens in models.ts).
- `src/host/diagnostics.ts`: `createDiagnosticsLines` renders the
  publication partition (counts, blocked with gaps, degraded, LKG,
  failure kind). Lines flow to TUI through the existing diagnostics
  RPC event unchanged.
- `src/host/publication-rpc.ts` (new): `publicationRpc` schema with
  `state` (summary for an endpoint) and `accept({ modelId })`
  (explicit acceptance); registered in `registerAudit` (legacy single
  snapshot) and `registerMultiEndpointAudit` (per-endpoint snapshots).
  Acceptance applies on the next discovery refresh (poll/event/force);
  the RPC result reports remaining gaps immediately.

## Alternatives considered

- Reimplementing completeness checks in the adapter: rejected, Core is
  the single source of truth.
- Persisting degraded acceptance in host storage: rejected for this
  phase; acceptance lives in snapshot-anchored memory. Restart requires
  re-acceptance, the safe default for degraded exposure.
- New TUI card for acceptance: deferred; diagnostics lines (with
  blocked gaps and degraded state) already reach TUI through the
  existing diagnostics result store.
