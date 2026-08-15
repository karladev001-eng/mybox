# ADR 0002: Use a local-first Tauri workspace

- Status: Accepted
- Date: 2026-08-15

## Context

Users need a local directory as the durable source of truth, while individual apps
may later use Google Cloud or other providers and multiple users may eventually
share data. Browser filesystem APIs do not provide a consistent desktop storage
boundary.

## Decision

The product target is a Tauri desktop shell around the existing React UI. The user
selects a local workspace directory, and Tauri implements host storage ports.
Cloud providers are replaceable adapters layered over the local-first model.

## Consequences

The application gains controlled filesystem and OS secret access while retaining
the current UI stack. Multi-device sync, conflict resolution, identity, and shared
workspaces are deliberately deferred and require later ADRs.

## Implementation notes

The Web build remains operational and uses the in-memory driver for tests. The
Tauri 2 host now provides directory selection, remembered workspace configuration,
and app-scoped JSON storage with traversal and symlink rejection, a 10 MB state
limit, and atomic replacement. Resource files, secret storage, and synchronization
adapters remain future work.
