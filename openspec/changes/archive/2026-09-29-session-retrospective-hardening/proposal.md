# Session retrospective hardening

## Why

The PR8 follow-up and v0.3.0 release exposed repeatable gaps that must not depend on conversational memory: a neutral zero-limit model can become an unusable OpenCode model, completed OpenSpec changes can remain active, and README/release-note references can drift from package/tag versions.

## What Changes

- Reject non-operational Core ModelSpecs at the OpenCode host-publication boundary.
- Add CI gates for completed-but-unarchived OpenSpec changes and release metadata consistency.
- Correct README current-release examples and current release-notes link.
- Record superseding discovery/release decisions in repository guidance.
