# Tasks

> Scenario coverage follows `litellm-discovery-core/docs/testing-standard.md`. Each `[TAG]` maps to a Scenario in `specs/endpoint-state-consistency/spec.md`; each tag has at least one piece of traceable automated evidence.

## 1. Canonical endpoint state model (pure)

- [ ] 1.1 Create `src/host/endpoint-state.ts` implementing `EndpointState`, `UserVisibleStatus`, `userVisibleStatus(state)`, Chinese label maps, `ApplyErrorCategory`, and `canPublish(state)`. Pure, no OpenCode imports.
- [ ] 1.2 Unit tests `test/endpoint-state.test.ts` cover all seven user-visible statuses ([STATE-*]), credential labels ([CRED-STORED-LABEL], [CRED-MISSING-IS-NOT-INVALID]), and `canPublish` semantics for [MODELS-HIDE-DISABLED] / [MODELS-HIDE-UNAPPLIED] / [MODELS-HIDE-INVALID] / [MODELS-SNAPSHOT-GATE].

## 2. parseOptions keeps invalid endpoints

- [ ] 2.1 Extend `PluginOptions.endpoints` entries with `validation: ValidationState`. Keep `baseUrl` as the raw user value on invalid entries (never propagated to fetch); expose a derived `okBaseUrl` only when `validation.kind="ok"`.
- [ ] 2.2 Update `endpointIdentity(...)` to refuse a `fixedBaseUrl` for invalid entries.
- [ ] 2.3 Tests cover [VALIDATION-CONSISTENCY] and [VALIDATION-INVALID-PRESERVED].

## 3. ProviderSnapshot carries canonical state

- [ ] 3.1 Extend `ProviderSnapshot` with `endpointState: EndpointState`; initialise for both legacy and explicit runtimes.
- [ ] 3.2 `index.ts` `reconcile` writes `desired` and `validation`; `sync.ts` `refreshOnce` writes `credential` and `applied` (one write per terminal branch).
- [ ] 3.3 Desired state never rewritten on apply failure ([DESIRED-PERSISTED-ENABLED], [DESIRED-NO-SILENT-ROLLBACK]).
- [ ] 3.4 Unit + integration tests cover the transitions in `test/sync.test.ts` and `test/index.test.ts`.

## 4. `/models` strict semantics

- [ ] 4.1 Rewrite `applyProvider` to call `editor.add` only when `canPublish(snapshot.endpointState)` ([MODELS-HIDE-DISABLED] / [MODELS-HIDE-UNAPPLIED] / [MODELS-HIDE-INVALID]).
- [ ] 4.2 Snapshot restore path respects the same four dimensions ([MODELS-SNAPSHOT-GATE]).
- [ ] 4.3 Integration tests cover disable → disappear, apply-failure → disappear, invalid → never appear.

## 5. Management UI (TUI + server RPC)

- [ ] 5.1 `endpoint-command.ts` view: include per-endpoint `endpointState` summary for the TUI to render. List row / detail title derive from `userVisibleStatus`.
- [ ] 5.2 Replace "已连接" / "未连接" credential labels with the new four labels in both server view model and `tui-endpoints.ts`.
- [ ] 5.3 Add `endpointRpc.trigger({ endpointId })` server handler ([RETRY-SUCCESS]); refuse with `code=invalid-state` for disabled/invalid endpoints ([RETRY-NO-OP-FOR-DISABLED]).
- [ ] 5.4 Endpoint detail menu adds `Retry / 重新应用` only when the canonical status demands it.
- [ ] 5.5 Apply failure notifies honestly (warn: "已启用，但运行时尚未生效：<reason>") — never reports success.
- [ ] 5.6 Tests in `test/endpoint-command.test.ts`, `test/endpoint-manager.test.ts`, `test/tui-endpoints.test.ts` for [CONSISTENCY-ALL-VIEWS].

## 6. Diagnostics command

- [ ] 6.1 `/litellm-diagnostics <id>` prints the full per-endpoint record for any state ([DIAG-DETAIL-DISABLED] / [DIAG-DETAIL-INVALID] / [DIAG-DETAIL-NEEDS-AUTH]); never falls back to "未激活 · models=0".
- [ ] 6.2 Overview lists every configured endpoint (including invalid / disabled) with `✓/○`, provider id, user-visible status and `models=N`.
- [ ] 6.3 Diagnostics never includes URL, API key, raw error bodies.

## 7. Real OpenCode E2E (gate per AGENTS.md §4)

- [ ] 7.1 Extend `scripts/e2e-real-opencode.mjs` against real OpenCode 2.0.16 with the following scenarios, each asserting a user-visible outcome:
  - Scenario A: disabled → enable → apply success → UI shows `Enabled · Active` → models appear in `opencode models` → diagnostics shows applied.
  - Scenario B: Active → disable → runtime unregister → UI shows `Disabled` → models disappear.
  - Scenario C: enabled endpoint without key → `Enabled · Needs authentication` → no models → `/connect` saves key → Retry/refresh → `Enabled · Active`.
  - Scenario D: invalid endpoint (bad baseUrl in managed config) → listed → `Invalid configuration` clear → no provider → `/models` unaffected; also covers `Disabled · Invalid configuration`.
  - Scenario E: enable with simulated runtime apply failure → persisted enabled → `Enabled · Not applied` / `Enabled · Error` → `/models` empty → diagnostics reports failure.
  - Scenario F: `Enabled · Not applied` → fix condition → Retry → `Enabled · Active` → `/models` populated.
  - Regression sweep: `/litellm-endpoints` interactive, `/litellm-diagnostics <id>` never degrades to overview, every registered model has positive `limit.context/limit.output`.

## 8. README

- [ ] 8.1 Update `/litellm-endpoints`, `/litellm-diagnostics`, "常见问题" and "升级与回滚" sections with the seven user-visible statuses, Retry action, strict `/models` semantics.
- [ ] 8.2 Audit code block language tags: any JSON snippet intended for direct copy is strict JSON; `jsonc` only where comments are intentional.

## 9. OpenSpec / closure

- [ ] 9.1 `openspec validate --all --strict --no-interactive` passes.
- [ ] 9.2 `npm run test:openspec-closure` passes; tasks updated truthfully before archive.

## 10. Cross-repo parity check

- [ ] 10.1 Confirm Pi-side change implements the same status tokens and labels.
- [ ] 10.2 Confirm `litellm-discovery-core` requires no change.
