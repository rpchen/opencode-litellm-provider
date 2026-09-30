# Design

## Context

The existing endpoint UI is rendered in `session.composer.top` as `<text onMouseUp>` rows. It has no selected row, no keymap layer and no Enter handling. The server command also emits a one-shot `shown` event, while the TUI never reads the already-available endpoint `state()` during recovery. Diagnostics similarly emits a one-shot result but does not place that result in the value returned by `auditRpc.latest()`.

## Decisions

1. Endpoint activation uses the host-native `context.ui.dialog.select()` surface instead of reimplementing list navigation in plugin JSX.
2. The endpoint server `sequence` identifies a user request to show the selector. Activation mutations return updated state but do not create another show request or emit another `shown` event.
3. TUI setup and periodic refresh read both audit `latest()` and endpoint `state()`; sequence de-duplication prevents the same recovered request from reopening.
4. Audit/diagnostics share the recoverable latest-result channel. A latest result may contain `lines`; TUI routes it to the diagnostics store exactly as it routes the live event.
5. The real-host E2E keeps local fake LiteLLM endpoints and isolated HOME/XDG state, and adds a PTY-backed TUI keyboard path. The test verifies a real slash command opens the selector, Enter toggles the first endpoint, provider/model publication changes immediately, and the endpoint can be re-enabled.

## Compatibility

No endpoint config or credential format changes. Desktop/Web behavior is unchanged. Legacy single-endpoint behavior remains intact.
