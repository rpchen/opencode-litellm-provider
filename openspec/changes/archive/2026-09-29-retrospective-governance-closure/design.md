# Design

- Keep runtime/model behavior and committed dist unchanged.
- `check-openspec-closure.mjs` scans active OpenSpec changes and fails when a tasks file has completed items and no unchecked items.
- `check-release-metadata.mjs` verifies package.json, both package-lock root version fields, README fixed-version install example, README release-notes link, and the corresponding release-notes file.
- CI and Release execute both checks in addition to strict OpenSpec and existing delivery verification.
