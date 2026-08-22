# ADR 0021: Publish signed desktop releases and update MyBox in place

- Status: Accepted
- Date: 2026-08-17
- Supersedes the visibility decision in
  [ADR 0004](0004-private-github-repository.md)

## Context

Every MyBox change previously reached a device only as a hand-built installer,
so App changes shipped by reinstalling the shell. [ADR 0020](0020-track-installed-app-versions-and-host-updates.md)
gave each App a device-local installed version but left the shell itself with no
delivery path, and an App's new code cannot reach a device without the shell that
contains it.

The Tauri updater resolves a manifest and its artifacts over unauthenticated
HTTPS. ADR 0004 kept the repository private and recorded that visibility could
change later as an explicit decision. Serving updates from a private repository
would instead require distributing a GitHub token to every device.

## Decision

Publish the desktop app from the public `mybox` repository as signed GitHub
Releases, and make the repository public to serve them.

A tag matching `v*.*.*` triggers a workflow that builds, signs, and opens a
**draft** Release. A human publishes it; the updater reads only the latest
published, non-prerelease Release, so building never releases by itself.

Updates are signed with a minisign keypair. The public key is embedded in the
app and the private key exists only in GitHub Secrets and the maintainer's own
backup. The app verifies every downloaded artifact against the embedded key, so
a Release the keypair did not sign is rejected.

The shell version and each App's Registry version stay independent. Shipping a
shell release does not imply an App changed, and an App change is visible to
[ADR 0020](0020-track-installed-app-versions-and-host-updates.md)'s update
affordance only when its Registry version rises.

## Consequences

Source, history, and issues are publicly discoverable, so committed files carry
no secrets, no credentials, and no local machine paths or account names.

Losing the signing key ends the update channel: existing installs reject
anything signed by a replacement key and must be reinstalled by hand. The key is
therefore backed up outside CI.

Releases are Windows-only until the workflow's build matrix gains other targets.
A device on an older shell keeps running its bundled App code until the user
applies the update, so an App fix and its delivery remain separate events.

## Implementation notes

As of 2026-08-17, `.github/workflows/release.yml` builds through
`tauri-apps/tauri-action`, `mybox-app/src-tauri/tauri.conf.json` holds the public
key and the endpoint and enables `bundle.createUpdaterArtifacts`,
`mybox-app/src/desktop/app-updater.js` wraps check, download, and relaunch, and
`mybox-app/src/App.jsx` renders the update row in Settings. The web build
resolves the updater to a no-op so the browser preview keeps working.

Release `0.7.0` ships the shared App runtime and Connector foundation, the
default-installed Image App, improved Note Markdown editing, and the quiet
icon-led interface rules. The package, Tauri configuration, and Rust crate use
the same version so the tag produces one coherent signed update.

Release `0.7.1` makes Image's final Prompt editable and importable from Markdown,
plain text, or an enabled Note App. Its Note Page picker searches normalized Page
titles and Tags, while Image keeps ratio selection independent from generated
pixel dimensions. Image Registry `0.4.1` and Note Registry `1.14.1` expose the
corresponding App updates.

Release `0.8.0` replaces one-to-one Connections with durable visual Workflows,
projects shared Agent Operations as Workflow Commands, and adds manual, Event,
App-request, and scheduled execution with Tray recovery. Each Workflow owns one
bounded JSON document whose restricted path mappings can feed command input and
retain validated output such as Note Page titles. Image Registry `0.5.0` and Note
Registry `1.17.0` expose the corresponding App updates.

Release `0.8.1` updates Image Registry `0.5.1` with a full-window generated-image
viewer, content-responsive additional Prompt input, a Prompt rebuild action next
to generation, and consistent themed scrollbars across Image's horizontal and
vertical overflow regions. The viewer preserves the generated resource and its
actual dimensions; this patch changes only Surface interaction and delivery.
