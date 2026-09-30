# Tasks

- [x] Add fake OpenSpec repository fixtures covering missing ADDED capability, stale MODIFIED requirement, lingering REMOVED requirement, malformed delta and valid archive.
- [x] Implement the closure checker with the same semantic behavior as Core and the other adapter.
- [x] Run the checker regression suite from `test:openspec-closure` and keep independent clone/CI reproducibility.
- [x] Run strict OpenSpec validation and the repository's applicable validation gates.
- [x] Run the new gate over all historical archives and classify any legacy/unverifiable artifacts explicitly.
- [x] Restore any missing canonical representation found by historical archive verification without changing runtime behavior.
- [x] Remove fuzzy requirement-title reconciliation from the closure gate and replace it with exact title, formal RENAMED, and explicit version-controlled legacy compatibility aliases.
- [x] Add regression coverage proving similar titles remain independent, RENAMED and legacy aliases reconcile, invalid compatibility mappings fail closed, same-day lexical order does not define semantic order, ambiguous chronology fails closed, and explicit chronology resolves ambiguity.
- [x] Mark this change complete, archive it with the OpenSpec CLI, rerun strict validation and rerun the new closure gate.
- [x] Replace the fabricated total order with a partial-order chronology model (before/after/same/incomparable/unknown) and fail closed on same-commit or incomparable conflicting states without any lexical/timestamp/array fallback.
- [x] Replay ADDED/MODIFIED/REMOVED/RENAMED as one state machine per requirement identity so REMOVED participates in chronology and re-ADDED after REMOVED is judged by chronology.
- [x] Replay within one archived delta in the OpenSpec 1.13.2 apply order and fail closed on grammar-rejected conflicting transitions inside one delta.
- [x] Add regression coverage for ADDED -> REMOVED, MODIFIED -> REMOVED, REMOVED -> ADDED, RENAMED chains, conflicting RENAMED, same-commit same/conflicting states, incomparable histories, reversed lexical ancestry and partial-order fixture injection.
- [x] Provide complete Git history in every workflow job that runs the closure gate (including release.yml) and guard it with a static regression test.
- [x] README impact: No README change: no user-visible behavior.
