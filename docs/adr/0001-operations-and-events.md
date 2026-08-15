# ADR 0001: Use operations and events for app collaboration

- Status: Accepted
- Date: 2026-08-15

## Context

MyBox apps must remain independently usable and removable while still supporting
app-to-app flows and AI-driven use. Direct storage access or imports would couple
apps to implementation details and make removal unsafe.

## Decision

Apps own private state and collaborate only through host-mediated, versioned
operations and immutable events. Flows and agents use those same contracts. JSON
Schema validates operation inputs, outputs, and event payloads, while large data is
passed by an authorized resource reference.

## Consequences

Apps can change their storage implementation without breaking consumers, and the
host can enforce permissions and audit all callers. Cross-app transactions are not
atomic; workflows must handle partial failure with retry or compensation.

## Implementation notes

The initial contract and host are implemented in `mybox-app/src/core/` with tests
covering routing, validation, events, authorization, and removal.
