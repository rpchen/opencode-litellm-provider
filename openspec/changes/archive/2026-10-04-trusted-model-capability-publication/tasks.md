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
- [x] Consume Core degradation eligibility in `/litellm-accept-degraded`; reject ineligible statuses without a success message.
- [x] Seed LKG with the Core captured publication verdict.
- [x] Source-level typecheck, unit tests, and TUI render against reviewed Core head `1cd6bc285cdf692c335d3fd401a4e4436eb515ef`.
- [x] Align Core-copy fixtures/tests with group-wide limit/modality/identity evidence (Core branch head `8afc3e7d7a7b98581626fedb0322099ad3933cce`).
- [x] Extend Real OpenCode 2.0.16 E2E assertions for the publication boundary (incomplete fixture model never listed, diagnostics names it).
- [x] `npm run build:dist` to the merged Core SHA + `npm run verify:dist`, `npm run test:distribution`, `npm run test:package` (Core #26 merged as `649bc84fff85488a5fc6bda0c2a2a9504a357db4`; dist rebuilt to that SHA and all package/distribution gates green locally and in PR #53 CI).
- [x] Real OpenCode 2.0.16 E2E run (PR #53 head `c625f11a3625e437991df67b8a8550c5a74047c9`: `CI` SUCCESS + `Real OpenCode 2.0.16 E2E` SUCCESS, covering the publication partition, toggle reasoning, LKG substitution, degraded accept/reject and metadata-failure diagnostics).
- [x] Archive the change with OpenSpec CLI and re-run strict validation (dist refreshed to merged Core `649bc84fff85488a5fc6bda0c2a2a9504a357db4`, PR #53 CI + Real OpenCode 2.0.16 E2E green).