# ADR 0015: Prepare Blocks for future realtime collaboration

- Status: Accepted
- Date: 2026-08-16

## Context

Shared Projects are intended to support simultaneous editing in a later release,
while the initial product remains local-first and single-user. Adding a complete
CRDT and synchronization service now would force unresolved provider, identity,
offline, and retention choices into the first editor implementation.

## Decision

Real-time multi-user editing is the collaboration target. The initial model gives
Pages and Blocks stable identities and revisions, represents mutations as
Operations, and requires callers to state the revision they intend to change so
conflicts are detected instead of silently overwritten. The CRDT or equivalent
merge algorithm, presence protocol, and synchronization adapter are deferred to a
later ADR.

## Consequences

The first release does not provide live cursors or multi-device synchronization,
but it must not rely on replace-the-whole-Page writes or positional identities
that would prevent later concurrent editing. Adding collaboration still requires
identity, transport, offline merge, history, and access-revocation decisions.

## Implementation notes

As of 2026-08-16, every Page and Block has a stable identity and revision, editor
changes are expressed as typed mutations, and stale expected revisions fail with
an explicit conflict instead of overwriting newer state. No CRDT, presence,
network synchronization, or shared-session protocol has been added.
