# ADR 0020: Track installed App versions and apply catalog updates through the Host

- Status: Accepted
- Date: 2026-08-16

## Context

The App Registry identifies installable Surfaces, but the device installation
record previously retained only App IDs. MyBox therefore could not distinguish
the version active on a device from a newer version offered by its catalog, show
an accurate update state, or retain the result of an update across restarts.

## Decision

Every App Registry definition declares a SemVer version. The Host persists the
installed version beside each installed App ID, separately from the version in
the current Registry definition. A newer Registry version makes that App
updateable; equal or older Registry versions do not offer a downgrade.

The App launcher and App catalog display installed versions. When the Registry
offers a newer version, they expose a labeled update button with explicit
in-progress and completion or failure feedback. Applying an update changes only
that App's installed-version record and keeps all other App installations intact.

Installation persistence uses schema version 2. Schema version 1 records are
accepted and mapped to the corresponding current Registry version so an existing
device does not receive a false update prompt merely because earlier MyBox builds
did not record App versions. Legacy custom Apps begin at `1.0.0`.

The current Registry contains trusted code bundled with MyBox, so this first
implementation applies an already-available bundled catalog version. Downloading
packages, verifying signatures, retaining parallel executable versions, running
data migrations, rollback, and checking remote update sources remain future Host
capabilities. They must complete before a remote package version is advertised as
available. Because this build retains only the current bundled Surface, launch is
blocked while the installed and Registry versions differ; MyBox never runs newer
App code while still claiming the older version is active. Agent- or
Flow-initiated updates will use a versioned Host Operation with authorization and
audit; this UI handles a direct User action only.

## Consequences

Each App now has a durable device-local lifecycle version independent from the
MyBox shell version. Future App releases can increment the Registry version and
reuse the same update affordance after their trusted package and migration steps
are connected to the Host. The UI never claims an update is complete until the
new installed version has been persisted.

## Implementation notes

As of 2026-08-16, `mybox-app/src/core/app-version.js` validates and compares
SemVer values, `mybox-app/src/core/app-installations.js` owns schema-v2 snapshots
and v1 compatibility, and `mybox-app/src/App.jsx` renders per-App versions and
update actions. Built-in and newly created custom Apps start at `1.0.0`.
