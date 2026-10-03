# Tasks (OpenCode adapter)

- [x] Add entry-based host mapping with conservative Core tool flag; keep operational-limits guard.
- [x] Add snapshot-anchored publication state (LKG store + accepted set) and summary helpers.
- [x] Consume Core `buildPublicationResult` in the sync default path (publish only configured / configured-lkg / accepted-degraded).
- [x] Classify metadata failures with Core taxonomy; substitute valid LKG; seed LKG on configured discoveries.
- [x] Persist only publishable non-degraded specs; filter operational limits on restore.
- [x] Surface publication states, gaps, LKG selection, degraded acceptance, and provenance in diagnostics lines (flows to TUI).
- [x] Add publication RPC (`state` / `accept`) in legacy and multi-endpoint audit registrations.
- [x] Add adapter tests: mapping (tools conservative, guard), partition (blocked never registered), failure/LKG substitution, RPC accept longitudinal (Core -> ProviderSnapshot -> RPC -> TUI lines).
- [x] Update README for the degraded/LKG diagnostics concepts and the accept-degraded command.
- [x] Run `node scripts/run-with-core.mjs typecheck`, unit tests, `npm run test:delivery`, `npm run test:tui-render`, `npm run validate:spec` against the Core branch SHA (`60b97d0`).
- [x] Extend Real OpenCode 2.0.16 E2E assertions for the publication boundary (incomplete fixture model never listed, diagnostics names it).
- [ ] `npm run build:dist` to the merged Core SHA + `npm run verify:dist`, `npm run test:distribution`, `npm run test:package` (blocked until rpchen/litellm-discovery-core#26 merges).
- [ ] Real OpenCode 2.0.16 E2E run (blocked: it installs a committed dist, so it must run after the Core merge + dist refresh).
- [ ] Archive the change with OpenSpec CLI and re-run strict validation (blocked on the same merge order).