# ADR 0003: Require scoped authorization and audit for non-user callers

- Status: Accepted
- Date: 2026-08-15

## Context

AI agents and saved flows need both read and write access, but silently allowing
all manifest capabilities would make destructive and external actions unsafe.

## Decision

Every operation declares an effect and allowed caller types. The host authorizes
every invocation. Agent and flow reads require a stored scope grant, writes require
an explicit or revocable session grant, and destructive or external effects require
fresh confirmation. Audit entries contain metadata and outcomes, never raw payloads.

## Consequences

Agent capabilities remain useful without bypassing app boundaries. The host must
provide grant management and approval UI before unattended writes are enabled.

## Implementation notes

The initial host exposes an authorization hook and ships a conservative default:
non-user write, destructive, and external operations require `approval.granted`.
