# ADR 0004: Keep the initial GitHub repository private

- Status: Accepted
- Date: 2026-08-15

## Context

The project contains an early application framework and will later integrate local
files, AI providers, and cloud credentials. A GitHub repository is required, but
public distribution and its security review have not been requested.

## Decision

Create the initial `mybox` GitHub repository as private under the authenticated
owner. Commit source, documentation, tests, and intentional design assets while
excluding dependencies, build artifacts, tool-managed skills, user workspaces,
environment files, and secrets.

## Consequences

The source is backed up and ready for collaboration without being publicly
discoverable. Visibility can be changed later as an explicit repository decision.

## Implementation notes

The repository is initialized at the workspace root so `AGENTS.md`, `CONTEXT.md`,
ADRs, and the application remain one versioned unit.
