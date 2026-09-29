# Operational limit publication guard

Prevent OpenCode from publishing discovered models whose final Core metadata still lacks usable context or output token limits. Core may retain those models for diagnostics, but the host must not expose unusable zero-limit model definitions.
