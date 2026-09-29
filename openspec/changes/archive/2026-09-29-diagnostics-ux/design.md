# Design

- Discovery/cache state remains UTC/epoch based; timezone conversion belongs only to the OpenCode presentation layer.
- Absolute timestamps use a stable `YYYY-MM-DD HH:mm:ss UTC±HH:mm` representation based on the running host's timezone/DST rules.
- Diagnostics and audit result stores gain a session-scoped dismiss operation. Dismiss removes the rendered result but keeps the monotonic sequence watermark.
- Because the watermark remains, polling `rpc.latest()` with the same sequence cannot resurrect a dismissed audit card. A newer sequence is accepted and shown normally.
- Both diagnostics and audit cards expose a `[关闭]` mouse action. No model/session prompt is created by dismissing.
