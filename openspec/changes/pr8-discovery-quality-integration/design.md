# Design

- OpenCode continues to consume the neutral Core `ModelSpec`; the adapter only adds the host SDK package.
- Distinct `limit.context`, `limit.input` and `limit.output` values must survive host adaptation unchanged.
- The vertical adapter test uses the shared fixture and asserts both metadata and SDK package selection.
- The committed distribution must record the merged PR8 Core SHA and pass delivery-integrity checks.
