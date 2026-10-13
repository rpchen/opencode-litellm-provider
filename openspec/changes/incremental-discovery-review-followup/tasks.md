# Tasks

## 1. Adapter integration

- [x] 1.1 Replace OpenCode-local model delta, publication merge, catalog miss and diagnostics merge implementations with Core #37 helpers.
- [x] 1.2 Reprocess only Core's degraded-catalog `metadata-unavailable` withheld candidates on same-set refresh; leave stable unmatched/invalid/incomplete models and normal registrations untouched.
- [x] 1.3 Rebuild `dist/` and provenance using only Core SHA `a08db4a70498ae7f397c264bb3f7c01eb196e1f8`.

## 2. Evidence and delivery

- [x] 2.1 Add adapter tests for temporary metadata recovery on the unchanged model set and stable unmatched non-retry.
- [x] 2.2 Restore real OpenCode 2.0.16 E2E coverage for actual catalog outage, LKG use, fresh recovery, and the same-set transient metadata recovery path; retain incremental scenarios.
- [ ] 2.3 Run OpenCode full gates and Real OpenCode 2.0.16 E2E at the final immutable candidate commit; record CI evidence.
- [ ] 2.4 Strict-validate and archive this follow-up change after adapter CI/E2E passes; rerun OpenSpec closure.

### Scenario → test evidence

| Scenario | Test evidence |
|---|---|
| Temporary catalog failure recovers without a model-set change | `test/incremental-discovery.test.ts` — `temporary metadata-withheld models recover on an unchanged set; stable unmatched models do not retry`; real-host outage/recovery chain in `scripts/e2e-opencode-v2.mjs` |
| Stable unmatched identity does not retry | `test/incremental-discovery.test.ts` — same test's `stable-unmatched` assertions |
| Real-host outage uses LKG and recovers | `scripts/e2e-opencode-v2.mjs` — isolated candidate install, fake LiteLLM, real catalog 500, publication RPC and TUI diagnostics |
