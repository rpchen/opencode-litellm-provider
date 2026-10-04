# Trusted model capability publication (OpenCode adapter)

## Why

Core change `trusted-model-capability-publication`
(rpchen/litellm-discovery-core PR #26) establishes the formal
publication loop: completeness policy, false-vs-unknown tri-states,
reasoning/levels decoupling, deterministic inheritance, failure
taxonomy, TTL-free LKG, explicit degradation, and provenance. OpenCode
must consume the same Core verdicts instead of reimplementing policy:
only `configured`, `configured-lkg`, and user-accepted `degraded`
models reach host registration, host tool flags must not silently
upgrade `unknown` to enabled, and failures must never produce
pseudo-complete models.

## What Changes

- Discovery consumes Core `buildPublicationResult`: only configured,
  configured-lkg, and user-accepted degraded models reach OpenCode
  registration; everything else stays visible in diagnostics with its
  status and gap list, never disguised as a normal model.
- Host mapping applies the conservative Core tool flag for degraded
  entries (`unknown` tools map to disabled); the operational-limits
  guard stays as defense in depth.
- The persisted discovery snapshot holds only publishable non-degraded
  specs; restore filters operational limits.
- Metadata fetch failures are classified with the Core taxonomy and
  never produce pseudo-complete models; a per-endpoint LKG store (Core
  validity, no TTL) substitutes only provably belonging snapshots, and
  diagnostics shows live-vs-LKG selection with reasons.
- Diagnostics display publication states, missing/unknown/illegal
  fields, LKG selection, degraded acceptance, and field provenance;
  the same lines flow to TUI through the existing diagnostics RPC event.
- New publication RPC (`state` / `accept`) next to the audit RPC gives
  explicit user-accepted degradation that keeps the degraded label and
  never re-labels models as fully configured.
- References Core change `trusted-model-capability-publication`
  (rpchen/litellm-discovery-core PR #26); `dist/` refresh follows Core
  merge (one Core SHA per update build).

## Terminology

See the Core change for normal publication, `false` vs `unknown`, LKG,
and explicit degradation. OpenCode adds no new domain semantics: it maps
Core verdicts to provider registration and user-facing diagnostics/RPC/TUI.

## Non-Goals

- Endpoint CRUD changes, polling/activation changes, price-precision
  work, per-model hardcodes, broadening publication counts.
