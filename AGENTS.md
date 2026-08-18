# MyBox Working Agreement

These instructions apply to the whole repository. A deeper `AGENTS.md` may add
area-specific rules, but it must not weaken these rules.

## Read narrowly

1. Start with this file, the nearest `README.md`, `CONTEXT.md`, and the ADR index.
2. Use targeted file listings and searches. Do not recursively read the repository
   or load entire directories into context.
3. Open only the files named by the nearest README or required to answer the
   current task. Expand the scope only when a concrete dependency requires it.
4. Do not inspect generated, vendored, cache, build, or binary content unless the
   task specifically concerns it. This includes `.agents/`, `node_modules/`,
   `dist/`, coverage output, screenshots, and media assets.

**If the task is scoped to creating or changing one App under
`mybox-app/src/<app-id>/`** — not the host framework, the desktop shell, or
another App — read only `docs/app-authoring.md` and that App's own
`README.md`. That document is self-contained: it restates the manifest,
storage, registration, and testing contract an App needs, and lists exactly
what you do not have to open. Fall back to the rest of this file and the
broader repository only if the task turns out to need `src-tauri/`, the
`desktop/` bridge beyond one App's storage driver, another App's internals,
or a release.

## Design work

- Before creating, changing, or reviewing any user-visible interface, read the
  repository-root `FRONTEND.md` and follow it as the design source of truth.
- Preserve semantic controls, keyboard behavior, focus visibility, and accessible
  names while applying MyBox appearance. Exposed OS or framework default drawing
  is a UI bug, including native square popups that cannot be fully themed.
- Verify every affected popup and Normal, Hover, Pressed, Selected, Focused, and
  Disabled state in the actual dark desktop surface before handoff.

## Document every change

- Every change set must leave an ADR trail in `docs/adr/`. Create a new ADR when
  making a new architectural, product-behavior, data, security, or workflow
  decision. When work only implements an existing decision, update the relevant
  ADR's implementation notes instead of inventing a duplicate decision.
- Create the ADR before or alongside implementation, and keep it synchronized
  when the implementation changes the decision.
- Every first-party project directory must contain a concise `README.md` describing
  its purpose, boundaries, important entry points, and which files normally need
  to be read. Add the README in the same change that creates a directory.
- The README rule excludes generated, vendored, cache, build, user-workspace, and
  tool-managed directories such as `.git/`, `.agents/`, `node_modules/`, and
  `dist/`.
- Update `CONTEXT.md` when a task introduces or changes a domain term.

## Public repository

- The repository is public. Keep secrets, credentials, local machine paths, and
  account names out of committed files.
- The release signing key lives only in GitHub Secrets and a maintainer backup.
  Losing it ends the update channel for every existing install.

## Architecture invariants

- Apps are independent, removable units and own their private state.
- Apps collaborate only through host-mediated, versioned operations and events;
  they never read or mutate another app's storage directly.
- Flows and AI agents use the same public operations as other callers.
- Every operation declares its effect and allowed caller types. Agent writes,
  destructive actions, and external side effects pass through host authorization
  and audit logging.
- Local workspace data is authoritative. Cloud storage and future sharing are
  adapters, not alternate access paths into app internals.
- The desktop shell currently runs with no Content Security Policy. Set one in
  `tauri.conf.json` before rendering remote content or untrusted HTML.

## Verification

- Run the smallest relevant tests first, then the package build before handoff.
- Report any verification that could not be run and why.

## Releasing

[ADR 0021](docs/adr/0021-publish-signed-desktop-releases.md) describes how an
update reaches a device.

- Move `mybox-app/package.json`, `mybox-app/src-tauri/tauri.conf.json`, and
  `mybox-app/src-tauri/Cargo.toml` to the same version, then push a matching
  `v*.*.*` tag. CI opens a draft Release; publishing it is what delivers the
  update.
- Raise an App's version in `mybox-app/src/apps/registry.js` whenever that App
  changes. Users see an update only when that number rises above the installed
  one ([ADR 0020](docs/adr/0020-track-installed-app-versions-and-host-updates.md)).
- The release job depends on the `tauri` script in `mybox-app/package.json` and
  on `bundle.createUpdaterArtifacts` in `mybox-app/src-tauri/tauri.conf.json`.
  Dropping the latter yields unsigned artifacts that every install rejects.
- The release job also depends on the "Build the sync server bundle" step
  running `npm ci && npm run build` in `sync-server/` before the Tauri action:
  `src-tauri/build.rs` embeds that bundle via `include_str!` and fails the
  Rust build outright if it is missing, per
  [ADR 0024](docs/adr/0024-deploy-the-sync-server-through-the-cloudflare-api.md).
