# ADR 0029: Restore the last working surface

- Status: Accepted
- Date: 2026-08-20

## Context

MyBox always opened on the App launcher, even when the User had been working in
another Host destination or an App such as Note. Repeatedly navigating back to
the same surface made short desktop sessions unnecessarily slow.

## Decision

The Host remembers the last stable destination and, when applicable, the ID of
the open installed App. Each App remains responsible for any finer location
inside its own surface; this Host decision does not persist a selected Page or
other App-private navigation.

Only durable navigation state is restored. Transient UI such as modals, menus,
search text, assistant panels, drafts, and pending confirmations is not restored.
If a remembered App is no longer installed, the App launcher opens instead.

## Consequences

Startup resumes the useful surface without persisting transient or sensitive
input. The Host does not inspect App-private navigation state, and an uninstalled
App never leaves the User stranded on an invalid screen.

## Implementation notes

The Host stores `view` and optional `appId` in `mybox-host/ui/session.json`.
The record is versioned and validated through the existing app-scoped storage
port before React applies it.
