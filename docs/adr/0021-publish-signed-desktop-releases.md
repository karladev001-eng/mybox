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

Release `0.8.2` updates Note Registry `1.18.5` with User-selected Project
directories for cloud-drive folder synchronization while keeping Cloudflare
sharing independent. Project settings show the current store path and a member
table, use a neutral default author color, and render configured author colors
consistently in local and shared Projects. GitHub-linked sessions use the login
name for account presentation without exposing credentials or replacing the
stable internal profile ID.

Release `0.8.4` updates Note Registry `1.19.2` so every existing Project is
migrated from the common JSON state or legacy App-data store into its own
Project-named directory after the workspace is ready. Location changes retain a
full Page snapshot, including Trash. Project-store and Cloudflare Pages now use
the same Yjs document for creation, Trash moves, restoration, and permanent
deletion, avoiding stale local revisions and missing-Page errors.

Release `0.8.5` updates Note Registry `1.19.3` so completing a PageLink in a
shared Project can create its missing target Page. The Page and resolved link
enter the shared Yjs document in one transaction, while Active and Trash retain
the same Project-wide title uniqueness rule as local Projects.

Release `0.8.6` updates Note Registry `1.19.6` and Image Registry `0.5.5`.
Existing Note Projects migrate into Project-named directories, and the same
runtime-owned shared document now supports Page creation, Tags, Image's Note
Page import, and Project-store persistence. Note restores the last accessible
Project and Page; Image restores the last generated image and fits portrait
results to the available viewport without cropping. Resume-position Operations
degrade safely during an in-place Surface/Host version transition, so optional
state restoration cannot hide authoritative Projects or generation history.

Release `0.8.7` updates Note Registry `1.19.7` with explicit Block selection,
Ctrl/Cmd and Shift range selection, and atomic multi-Block deletion. Successful
single and bulk deletions have a visible undo action and `Ctrl+Z` structural
undo outside native text editing. The local JSON model and shared Yjs model use
the same removal and restoration mutations, retaining Block IDs, Page links,
and ordering while synchronizing an undo as a new edit.

Release `0.9.0` delivers the record-centered workspace (ADRs 0043–0050),
Knowledge 1.22.10 and Image 0.5.8. It includes durable Context notebooks and
PageLinks, immutable File originals and inline image/PDF views, search-first
navigation, sequential keyboard entry, outlines, resizable assistants and four
shared themes. Workflow surfaces/execution are retired while their stored data
is retained. Existing shared sync servers require redeployment for the updated
record/File protocol. Native IME/DPI and exhaustive pointer-state checks remain
unverified; automated checks and earlier browser reviews are recorded in the
individual implementation ADRs.

Verification for 0.9.0: 199 core, 4 packaging, 16 sync unit, 18 server integration,
7 live client and 37 native Rust tests passed (7 existing Rust tests ignored).
Frontend and embedded sync-server bundles built successfully.


## Release 0.10.0 preparation

The 0.10.0 candidate includes Knowledge 1.26.6 and Image 0.6.1: user Prompts,
generation records and immutable originals move into Knowledge; the workspace
graph adds side-by-side navigation and temporary lexical/tag affinities.
Knowledge/native schema 5 and record sync protocol 4 require a coordinated
client/group-server update. Existing backups remain retained. Package, Tauri and
Rust versions are aligned; signing continues through the existing CI workflow.

The current framework, specification, vocabulary and system overview now reflect
these accepted decisions and retired Workflows/Folders. The implementation and
rollout checklist lives in [migration status](../migration-status.md), separating
user-confirmed image generation from workspace-specific migration verification.


## Automated verification — 2026-09-12

214 core tests, 4 Sites packaging tests, 16 sync unit tests, 19 local server
integration checks, 7 live client checks and 37 native Rust tests passed. The
7 pre-existing authenticated provider tests remain ignored; real image generation
was separately confirmed by the user. Frontend/package and embedded sync-server
builds passed. Vite reports the existing large-chunk warning.

The signed build was requested by pushing `v0.10.0` at `ee69407`. Workspace-specific
verification results are kept outside the public repository; the migration checklist
describes the general procedure without publishing instance-level metadata.

CI run 34688057096 completed successfully. Release 0.10.0 was published on
2026-09-12 with Windows MSI/NSIS installers, their signatures and latest.json.
The updater manifest version, artifact URLs and attached-signature correspondence
were checked before publication; the public latest endpoint returns 0.10.0.


Release 0.10.1 prepares the Image history-loading fix in ADR 0051. Knowledge
1.26.9 supplies authorized bulk image-record reads; Image 0.6.2 distinguishes
initial preparation from generation and prevents premature provider requests.
The storage schema and sync protocol are unchanged.

The 0.10.1 candidate also includes bounded Project reads/replay (ADR 0055),
editor write ordering, stale-read protection, draft/save feedback and live graph
refresh (ADR 0056 and ADR 0054). 224 core and 4 packaging tests pass; package
build and browser interaction checks passed. Native IME and provider generation
were not repeated for this patch. The existing large-chunk warning remains.
