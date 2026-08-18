# ADR 0024: Deploy the sync server through the Cloudflare API instead of a GitHub-connected button

- Status: Accepted
- Date: 2026-08-18

## Context

[ADR 0023](0023-user-operated-sync-servers-with-yjs.md) has a Project Owner click
a "Deploy to Cloudflare" button that connects a GitHub account, creates a
repository, and lets Cloudflare's own CI build and deploy the Worker from it.
Its implementation notes record that the Worker source had to move out of this
monorepo into a separate
[mybox-sync-server](https://github.com/karladev001-eng/mybox-sync-server)
repository, because the button does not reliably deploy from a monorepo
subdirectory.

Walking through that flow end to end surfaced real friction: the GitHub App
install step failed outright on first attempt ("Error connecting to git
account") and needed an uninstall/reinstall to recover; the flow spans several
Cloudflare dashboard screens (Git account, Build command, Deploy command,
repository access) with no MyBox-owned guidance on any of them; and the
generated `SERVER_SECRET` is shown once, masked, and can never be read back
through Cloudflare's UI, so a User who did not copy it immediately has no way
to recover it short of setting a new one by hand. None of this is a MyBox
surface — every screen belongs to Cloudflare or GitHub, so MyBox cannot fix,
skip, or simplify a step of it. This is also the barrier ADR 0023 already
named as a known cost: "Collaboration requires one person in each group to
deploy a server. That is a real barrier the button reduces but does not
remove."

Cloudflare also offers a token-scoped REST API for creating and managing
Workers, Durable Object namespaces, and secrets. `mybox-app/src-tauri` already
makes native HTTPS calls with `reqwest` for the sync protocol
(`sync_endpoints.rs`), and ADR 0006 already established the pattern for
holding a third-party API credential in the OS credential store rather than
app state.

## Decision

**MyBox deploys and manages the sync server itself, through the Cloudflare
API, using a User-supplied Cloudflare API token.** The GitHub App connection,
the Cloudflare dashboard's multi-screen Git-based deploy flow, and the
`mybox-sync-server` repository are no longer part of the default path. The
"共有を開始" (start sharing) action becomes: MyBox has (or asks for) a
Cloudflare API token, calls the Cloudflare API to provision a Worker if the
User does not already have one, and fills in the resulting endpoint and
`SERVER_SECRET` itself. The User never leaves MyBox for this.

**The Worker source returns to this monorepo**, at `sync-server/`, now that
deployment no longer depends on Cloudflare cloning a Git repository. It is
built to a single bundled script as part of the MyBox release build (the same
CI job that already produces signed desktop artifacts per ADR 0021) and
embedded in the Tauri binary, so deploying it at runtime needs no bundler, no
Node.js, and no network fetch of MyBox's own code — only the Cloudflare API
call that uploads the already-built script.

**One Worker per Cloudflare account, many Projects share it.** ADR 0023's "one
Durable Object per Project" is unchanged. MyBox provisions a Worker lazily on
the first Project a User shares, remembers that it already exists, and every
later shared Project claims a new Durable Object on the same Worker through
the claim/join protocol ADR 0023 already defined. Sharing a second Project
never provisions a second Worker.

**The Cloudflare API token is stored exactly like the API credentials ADR 0006
already governs**: under a fixed MyBox service name in the OS credential
store, submit-once from the WebView, never read back by it. MyBox's setup
copy tells the User to scope the token to Workers Scripts and Durable Objects
edit permissions for one account, not an account-wide token, mirroring
Cloudflare's own "Edit Cloudflare Workers" API token template.

**Manual connection remains available.** `connectSyncEndpoint`'s existing
"サーバーURL・合言葉" entry (ADR 0023) is not removed. A User who deployed a
Worker another way — by hand, from a fork, on different infrastructure — keeps
a working path that needs no Cloudflare API token at all. The API-driven flow
is the default for a User with no server yet, not the only way to have one.

**Stopping and destroying are different operations.** "共有を停止" already
means "forget this device's membership without touching the server" (ADR
0023). This ADR adds a separate, explicit "Workerを削除" action, gated to
whichever Project role or account scope owns the Worker, that calls the
Cloudflare API to delete the script. It is a `destructive` Operation, not a
by-product of leaving one Project, because a Worker can host several
Projects' Durable Objects at once.

## Consequences

- The one-time cost ADR 0023 accepted — "one person in each group deploys a
  server" — becomes a single MyBox-owned action instead of a five-screen
  cross-product flow the User must debug alone when it fails.
- MyBox takes on a real, ongoing engineering and maintenance surface: it now
  reimplements the sequence Cloudflare's own `wrangler` performs (script
  upload, Durable Object namespace binding, secret write, `workers.dev`
  subdomain resolution) against Cloudflare's REST API directly, and carries
  that surface across Cloudflare API changes going forward.
- The Cloudflare API token is a more powerful credential than the per-Project
  member token ADR 0023 already stores — it can create and delete Workers on
  the User's account. It needs its own setup copy and scope guidance, not a
  copy-paste of the sync-token pattern.
- `mybox-sync-server` stops being where new deployments originate. Workers
  already deployed through it keep running unaffected — Cloudflare does not
  care how a Worker was created — but MyBox cannot update or delete one of
  those through the new API-driven management action unless the User
  reclaims it under an API token first. That reclaim path is not designed by
  this ADR.
- The full deploy/manage path needs a real Cloudflare account to verify and
  cannot run in `npm test`, the same limitation `test:sync` already has for
  the wire protocol. It needs its own manual or gated integration check.

## Deferred

The exact Cloudflare API call sequence and required token scopes, the
`sync-server/` build step's place in CI, the reclaim path for a Worker
deployed through `mybox-sync-server` or by hand, rate limits and retry
behavior for the API calls, and the UI for the new "Workerを削除" action are
implementation work, not this decision. `mybox-sync-server`'s eventual
retirement is also not decided here — it stays the historical record for
existing deployments until a migration path exists.

## Implementation notes

As of 2026-08-18, `sync-server/` moved back into this monorepo from
[mybox-sync-server](https://github.com/karladev001-eng/mybox-sync-server)
unchanged in behavior; only its README's deploy instructions and this
repository's cross-links were rewritten. `sync-server/package.json`'s `build`
script bundles `src/index.js` into the single-file `sync-server/dist/worker.js`
with esbuild, keeping the `cloudflare:workers` runtime import external.

`mybox-app/src-tauri/build.rs` runs that bundler before the crate compiles
whenever `sync-server/node_modules` is already present, and fails the build
with an actionable message if `dist/worker.js` is still missing — it
deliberately never runs `npm install` itself, so `.github/workflows/release.yml`
installs and builds `sync-server/` as an explicit step before the Tauri
action, mirroring how it already installs `mybox-app`'s frontend dependencies.

`mybox-app/src-tauri/src/cloudflare.rs` embeds that bundle via `include_str!`
and holds the new native surface: the Account ID and Worker URL persist as
plain settings JSON (`cloudflare.json` in the Tauri app-config directory) and
the API token plus the generated `SERVER_SECRET` go in OS credential storage,
the same boundary ADR 0006 already uses for other provider keys.
`deploy_sync_server` is idempotent — redeploying reuses the stored secret
rather than rotating it — and returns the endpoint and secret to the caller
once; `mybox-app/src/knowledge/KnowledgeView.jsx`'s `deployAndShare` then
calls the existing `connectSync` (the ADR 0023 claim flow) with them, so the
Cloudflare-specific code never duplicates project-claim logic. The manual
"サーバーURL・合言葉" path from ADR 0023 is unchanged and reachable from the
same dialog via a "サーバーURL・合言葉を個別に入力" toggle.

`mybox-app/src/desktop/cloudflare.js` bridges the four native commands
(`cloudflare_status`, `set_cloudflare_credentials`, `deploy_sync_server`,
`delete_sync_server`) the same way `sync-endpoints.js` already bridges the
sync protocol's own commands, and `mybox-app/src/knowledge/client.js` is the
only file permitted to import either bridge module.

The exact Cloudflare API request shapes (multipart script upload metadata,
the `durable_object_namespace` and `secret_text` binding fields, the
`workers.dev` subdomain enable and lookup calls, and the token permission
scope) were confirmed against Cloudflare's current API reference during
implementation, but — unlike everything else in this change — could not be
exercised against a real Cloudflare account from this environment. This path
needs verification with a live API token before being trusted; a mismatch
would surface as a `deploy_sync_server` failure, not silent data loss, since
it runs before any Project claims the Worker.
