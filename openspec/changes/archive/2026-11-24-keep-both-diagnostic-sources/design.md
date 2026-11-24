# Design

## Context

The archived native-validation specification describes three source modes. In combined mode, current built-in results gate native validation on save; document versions and mirror readiness matter to that decision.

## Goals / Non-Goals

**Goals:**
- Remove source-selection state and branches while retaining the combined-mode lifecycle.
- Make old source settings ineffective.

**Non-Goals:**
- Change binary discovery, native error mapping, or save eligibility.
- Remove the independent native-validation setting.

## Decisions

- Remove the setting contribution and stop reading its value instead of retaining a selector with one option. Existing settings remain on disk but do not influence behavior.
- Always maintain built-in diagnostics. Determine native availability from the existing enable setting and binary discovery, and preserve the separate diagnostic collections.
- Reduce the native gate to the built-in-error check. Retain the current version-aware cache, pending-save and mirror-refresh handling instead of running native validation on stale or unavailable results.
- Keep existing handling of missing binaries, disabled native validation, auto-save and debug traces.

## Risks / Trade-offs

- [Removing branches affects asynchronous save handling] → Verify error and warning gates and pending document versions with focused tests.

## Migration Plan

Remove the setting and update outdated user documentation and maintainer instructions.
