# Fix diagnostics endpoint argument parsing

## Why

Real OpenCode 2.0.16 passes slash-command tail text through the command invocation's `prompt.text`. The multi-endpoint diagnostics command currently looks only for ad-hoc `args` / `arguments` / `argument` fields, so `/litellm-diagnostics company` is interpreted as a no-argument invocation and always shows the endpoint overview.

## What Changes

- Read the requested endpoint id from the real OpenCode command invocation shape (`input.prompt.text`), while retaining defensive compatibility with older synthetic shapes.
- Change unit tests to use the real invocation contract instead of the incorrect `args` fixture.
- Extend the pinned real OpenCode 2.0.16 E2E to execute diagnostics with an endpoint argument and assert endpoint-scoped detail rather than the overview.
- Document concrete endpoint-scoped diagnostics examples in README.
