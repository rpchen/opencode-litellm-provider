# Tasks

- [x] Add fake OpenSpec repository fixtures covering missing ADDED capability, stale MODIFIED requirement, lingering REMOVED requirement, malformed delta and valid archive.
- [x] Implement the closure checker with the same semantic behavior as Core and the other adapter.
- [x] Run the checker regression suite from `test:openspec-closure` and keep independent clone/CI reproducibility.
- [x] Run strict OpenSpec validation and the repository's applicable validation gates.
- [x] Run the new gate over all historical archives and classify any legacy/unverifiable artifacts explicitly.
- [x] Restore any missing canonical representation found by historical archive verification without changing runtime behavior.
- [x] Mark this change complete, archive it with the OpenSpec CLI, rerun strict validation and rerun the new closure gate.
- [x] README impact: No README change: no user-visible behavior.
