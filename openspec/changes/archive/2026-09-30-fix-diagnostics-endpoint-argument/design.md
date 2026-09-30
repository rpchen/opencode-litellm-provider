# Design

## Context

OpenCode V2 command definitions receive an invocation containing `sessionID`, `prompt`, and `delivery`. The slash-command tail is carried in `prompt.text`. The plugin's current parser was written against an inferred shape and therefore ignores real command arguments.

## Decisions

1. Treat `prompt.text` as the canonical source for a diagnostics endpoint argument.
2. Trim surrounding whitespace before endpoint lookup.
3. Retain `args`, `arguments`, and `argument` as compatibility fallbacks for tests or older host adapters, but never prefer them over the canonical host field.
4. The real-host E2E must submit `text: "company"` through OpenCode's session command API and prove the rendered diagnostics begin with `Endpoint：company` and do not render the multi-endpoint overview title.
5. No credential, activation, endpoint identity, or discovery behavior changes.
