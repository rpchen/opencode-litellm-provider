# Design

- Core may keep unknown-limit models for diagnostics; OpenCode publishes only ModelSpecs with positive context and output limits.
- Filtering is applied before the host registration view and defensively at registration so restored/injected models cannot leak zero limits.
- CI runs strict OpenSpec validation, active-change closure validation and release metadata consistency.
- Release metadata consistency covers package.json, package-lock root versions, README current-release install example, and the current docs/releases/vX.Y.Z.md link/file.
