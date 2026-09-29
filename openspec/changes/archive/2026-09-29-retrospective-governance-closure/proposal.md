# Retrospective governance closure

## Why

The PR8 follow-up and v0.3.1 release showed that cross-session guidance must be backed by executable repository checks. Completed OpenSpec changes must not remain active, and release metadata must not drift across package.json, package-lock, README fixed-version examples, and release notes.

## What Changes

- Reject completed-but-unarchived OpenSpec changes in CI and Release.
- Verify package/lockfile, README current fixed tag, and current release-notes link stay aligned.
- Record the release/session retrospective rules in maintainer guidance.
- No runtime or user-visible behavior changes.
