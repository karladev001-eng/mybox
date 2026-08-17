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

The reference Host exposes an authorization hook and its default policy requires
an exact non-user Operation grant. It then evaluates the Operation's Confirmation
class against the caller's current profile level or a fresh approval. Unattended
execution is therefore a persistent Host-wide User-profile policy rather than an
App-specific mode, while Operation grants and App data scopes remain separate
constraints. Audit metadata now records the Confirmation class and level.

Change-proposal storage and correlated Agent/User application audit remain to be
implemented for Knowledge writes; the current editor invokes Operations as the
local User, while direct Agent writes still pass through Host authorization.
ADR 0016 replaces this ADR's requirement that every destructive or external
invocation receive fresh confirmation; scoped authorization, Host enforcement,
and audit requirements remain in force.
