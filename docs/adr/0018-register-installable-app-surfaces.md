# ADR 0018: Register installable App surfaces through a Host catalog

- Status: Accepted
- Date: 2026-08-16

## Context

The launcher previously kept tile metadata in `App.jsx` and selected the
Knowledge editor through an App-ID-specific conditional. Each additional real App
would therefore require edits to the shell's list, loader, and rendering branch,
while removing an App discarded the only description needed to add it again.

## Decision

The Host owns an App Registry distinct from the runtime Operation manifest. An
App Surface definition declares a stable App ID, launcher metadata, whether it is
installed by default, and either a generic Surface or a lazy module loader with a
named export. The Registry validates definitions and rejects duplicate IDs before
the shell exposes them.

The installed launcher list is a selection from the Registry. Removing an App
removes it from that installed selection but retains its registered definition,
so the User can add it again from the catalog. A custom placeholder joins the same
Registry and generic Surface path. A future first-party App joins by registering
one definition rather than adding another conditional rendering branch.

Registry membership is presentation and lifecycle metadata only. It never grants
Operations, events, storage, provider capabilities, confirmation bypass, or data
scope. Runtime authority remains with the App manifest and Host authorization.

## Consequences

MyBox can expose independently loaded App Surfaces through one installation and
launch path. The Registry may later consume signed package metadata, but dynamic
third-party code loading, package trust, version compatibility, migrations, and
durable installed-state persistence require separate decisions.

## Implementation notes

As of 2026-08-16, `mybox-app/src/apps/registry.js` registers the built-in catalog,
including the lazy Knowledge Surface, and validates custom generic definitions.
The launcher catalog displays installed state and supports adding a removed
registered App again. Installed IDs and serializable custom metadata persist in
the current device's Host namespace. ADR 0020 extends those installation records
with per-App SemVer versions and Host update state. External package discovery
and trusted third-party code loading are not yet implemented.
