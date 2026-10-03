# Tasks (OpenCode adapter)

- [ ] Add entry-based host mapping with conservative Core tool flag; keep operational-limits guard.
- [ ] Add snapshot-anchored publication state (LKG store + accepted set) and summary helpers.
- [ ] Consume Core `buildPublicationResult` in the sync default path (publish only configured / configured-lkg / accepted-degraded).
- [ ] Classify metadata failures with Core taxonomy; substitute valid LKG; seed LKG on configured discoveries.
- [ ] Persist only publishable non-degraded specs; filter operational limits on restore.
- [ ] Surface publication states, gaps, LKG selection, degraded acceptance, and provenance in diagnostics lines (flows to TUI).
- [ ] Add publication RPC (`state` / `accept`) in legacy and multi-endpoint audit registrations.
- [ ] Add adapter tests: mapping (tools conservative, guard), partition (blocked never registered), failure/LKG substitution, RPC accept longitudinal (Core -> ProviderSnapshot -> RPC -> TUI lines).
- [ ] Update README for the degraded/LKG diagnostics concepts and the accept interaction.
- [ ] Run `verify:dist`, `test:delivery`, `typecheck`, `test`, `test:tui-render`, `test:distribution`, `test:package`, `validate:spec`.
- [ ] Run Real OpenCode 2.0.16 E2E (requires Core PR merge + `build:dist` refresh to the merged SHA first).
- [ ] Archive the change with OpenSpec CLI and re-run strict validation.
