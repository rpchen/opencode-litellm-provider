# Design

## Context

Core #37 is merged at `a08db4a70498ae7f397c264bb3f7c01eb196e1f8` and exports shared model delta, publication merge, diagnostics merge, catalog-miss and temporary metadata failure candidate helpers. OpenCode owns transport timing, catalog cache I/O, LKG store, ProviderSnapshot, reload and host mapping only.

## Decisions

- OpenCode supplies the previous successful Core result to `temporaryMetadataFailureModelNames`; the returned names are unioned with new names as the only processed subset.
- Prior configured models remain in the retained subset and are not re-matched or re-downloaded.
- A same-set refresh retries only withheld `metadata-unavailable` models when prior diagnostics say the models.dev catalog was degraded. Stable `unmatched`, `invalid-metadata` and `discovered-incomplete` results are not retried.
- Existing LKG store, publication gate, coordinator stale behavior, cancellation, endpoint scope and provider reload semantics remain unchanged.
- All delta/merge algorithms come from Core; OpenCode retains only lifecycle and host mapping.
- Real-host E2E creates a successful model/LKG entry, deletes that model identity, re-adds it during a real catalog outage to prove LKG use, then deletes/re-adds after recovery to prove fresh configuration. A separate newly added model proves `metadata-unavailable` recovery on an unchanged set.

## Evidence

`test/incremental-discovery.test.ts` covers transient recovery and stable unmatched non-retry. `scripts/e2e-opencode-v2.mjs` exercises real installer, fake LiteLLM/catalog, ProviderSnapshot, publication RPC and TUI assertions for outage/LKG/fresh recovery.
