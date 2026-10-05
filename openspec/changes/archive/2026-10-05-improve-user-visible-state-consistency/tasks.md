# Tasks

> Scenario coverage follows `litellm-discovery-core/docs/testing-standard.md`. Each `[TAG]` maps to a Scenario in `specs/endpoint-state-consistency/spec.md`; each tag has at least one piece of traceable automated evidence. Final state is recorded alongside each task.

## 1. Canonical endpoint state model (pure)

- [x] 1.1 `src/host/endpoint-state.ts` implements `EndpointState`, `UserVisibleStatus`, `userVisibleStatus(state)`, Chinese label maps, `ApplyErrorCategory`, `canPublish`, `canRetry`. Pure, no OpenCode imports.
- [x] 1.2 Unit tests `test/endpoint-state.test.ts` cover all seven user-visible statuses ([STATE-*]), credential labels ([CRED-STORED-LABEL], [CRED-MISSING-IS-NOT-INVALID]), and `canPublish` semantics for [MODELS-HIDE-DISABLED] / [MODELS-HIDE-UNAPPLIED] / [MODELS-HIDE-INVALID] / [MODELS-SNAPSHOT-GATE].

## 2. parseOptions keeps invalid endpoints

- [x] 2.1 `PluginOptions.endpoints` entries carry `validation: ValidationState`; `invalidBaseUrl` keeps the raw user value for diagnostics only (never propagated to fetch). → `src/options.ts`
- [x] 2.2 `endpointIdentity(...)` refuses `fixedBaseUrl` for invalid entries. → `src/endpoints.ts`
- [x] 2.3 Tests: `test/options.test.ts` [VALIDATION-INVALID-PRESERVED] and consistency with the runtime rule.

## 3. ProviderSnapshot carries canonical state

- [x] 3.1 `ProviderSnapshot.endpointState?: EndpointState`; `endpointStateOf(snapshot, id)` provides a documented backfill from legacy `audit.status` for older fixtures.
- [x] 3.2 `index.ts` `reconcile` / `setupEndpoint` / `deactivateOne` write `desired` and `validation`; `sync.ts` `refreshOnce` writes `credential` and `applied` on every terminal branch (including `removed`, `clearPersistedSnapshot`, refresh success, refresh error, cancellation pass-through).
- [x] 3.3 Desired state is never rewritten on apply failure ([DESIRED-PERSISTED-ENABLED] / [DESIRED-NO-SILENT-ROLLBACK]): no `writeActivation` call exists in the refresh path; persisted activation flows only through `setActivation`.
- [x] 3.4 Transitions covered in `test/sync.test.ts`, `test/index.test.ts`, and the new `test/endpoint-state.test.ts`.

## 4. `/models` strict semantics

- [x] 4.1 `applyProvider` calls `editor.add` only when `canPublish(endpointState)` ([MODELS-HIDE-DISABLED] / [MODELS-HIDE-UNAPPLIED] / [MODELS-HIDE-INVALID]).
- [x] 4.2 Snapshot restore path respects the same four dimensions ([MODELS-SNAPSHOT-GATE]) — persisted snapshots are loaded but the registration view published to the host is gated by `canPublish`.
- [x] 4.3 Integration tests `test/sync.test.ts` + `test/index.test.ts` cover deactivate → disappear, apply-failure → not-applied, invalid → never registered.

## 5. Management UI (TUI + server RPC)

- [x] 5.1 `endpoint-command.ts` `EndpointViewItem` carries canonical `state`, `status`, `statusLabel`, `canRetry` fields; `endpoint-manager.ts` derives them from `snapshot.endpointState`. `endpoint-rpc.ts` schema allows the new fields.
- [x] 5.2 Credential labels replaced everywhere: `已保存 API Key` / `API Key 来自环境变量` / `未保存 API Key` / `凭据状态未知`. "已连接"/"connected" never appear as a credential state.
- [x] 5.3 `endpointRpc.trigger({ endpointId })` is registered; `endpoint-manager.ts trigger(input)` refuses with `code=invalid-state` for disabled or invalid endpoints ([RETRY-NO-OP-FOR-DISABLED]), and calls `host.triggerEndpoint(id)` for valid retry targets.
- [x] 5.4 TUI detail menu (`tui-endpoints.ts`) shows `重新应用` only when `canRetry(state)` returns true.
- [x] 5.5 Apply failure surfaces honestly via the canonical status labels; never reports success (verified by [CONSISTENCY-ALL-VIEWS] tests in `test/multi-audit-command.test.ts`, `test/endpoint-manager.test.ts`, `test/tui-endpoints.test.ts`).

## 6. Diagnostics command

- [x] 6.1 `/litellm-diagnostics <id>` prints a complete per-endpoint record (single canonical line + the existing diagnostics body) for any state — disabled, invalid, needs-auth, not-applied, error, active. Never falls back to "未激活 · models=0" ([DIAG-DETAIL-DISABLED] / [DIAG-DETAIL-INVALID] / [DIAG-DETAIL-NEEDS-AUTH]).
- [x] 6.2 No-arg overview lists every configured endpoint (including disabled, invalid, and endpoints with no credential) with `✓/○`, provider id, user-visible status and `models=N`.
- [x] 6.3 Diagnostics never include URL, API key, raw error bodies (regression locked by existing audit / diagnostics tests).

## 7. Real OpenCode E2E (gate per AGENTS.md §4)

- [x] 7.1 `scripts/e2e-opencode-v2.mjs` updated to assert the new labels; Real OpenCode 2.0.16 E2E passes. Scenarios A, B, C, D, E, F covered via the existing full lifecycle (add → connect → replace → edit → enable → disable → reconnect → delete → legacy migration), with the new state labels asserted at every stage.

## 8. README

- [x] 8.1 Sections `/litellm-endpoints`, `/litellm-diagnostics`, "常见问题" updated with the seven user-visible statuses, Retry / 重新应用, and strict `/models` semantics. "连接成功但看不到模型" expanded with per-status troubleshooting guidance.
- [x] 8.2 Code block audit: existing `jsonc` blocks retain comments; no new `json` blocks added.

## 9. OpenSpec / closure

- [x] 9.1 `openspec validate --all --strict --no-interactive` passes.
- [x] 9.2 `npm run test:openspec-closure` passes; tasks status reflects reality before archive.

## 10. Cross-repo parity check

- [x] 10.1 Pi PR (rpchen/pi-litellm-provider#47) implements the same status tokens and 中文 labels.
- [x] 10.2 `litellm-discovery-core` unchanged.
