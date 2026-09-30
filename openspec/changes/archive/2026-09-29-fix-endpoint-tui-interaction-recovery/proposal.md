# Fix endpoint TUI interaction and command-result recovery

## Why

Real Windows/OpenCode 2.0.16 validation exposed two user-visible gaps that the existing PR9 gate did not exercise: `/litellm-endpoints` rendered text that looked actionable but had no keyboard navigation and unreliable mouse handling, and commands executed immediately after TUI startup could lose their one-shot RPC event and appear to do nothing.

## What Changes

- Replace the custom endpoint activation pseudo-card with OpenCode's native `ui.dialog.select()` so keyboard, Enter/Escape, mouse, focus and theme behavior are owned by the host.
- Make endpoint show requests recoverable through `endpointRpc.state()` and make diagnostics latest-state polling recover a missed diagnostics event.
- Extend the real OpenCode 2.0.16 E2E to cover startup-before-connect, independent endpoint credentials, interactive endpoint activation, and provider/model publication after activation changes.
- Update README so the documented activation UX matches the native selector and startup recovery behavior.
