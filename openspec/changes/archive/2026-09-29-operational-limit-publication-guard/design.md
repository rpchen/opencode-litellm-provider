# Design

- Core may represent unknown limits as zero for neutral discovery and diagnostics.
- OpenCode filters neutral ModelSpec entries at the host build boundary unless context and output are both positive.
- The guard is generic and independent of model/provider identity.
- Diagnostics can continue to explain omitted models because filtering occurs only at host publication.
- README fixed-version examples and release-note links must track the latest stable Release.
