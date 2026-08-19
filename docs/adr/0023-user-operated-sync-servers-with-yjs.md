# ADR 0023: Merge shared Projects with Yjs over a sync server each group runs

- Status: Accepted
- Date: 2026-08-17

## Context

[ADR 0022](0022-account-identity-through-oauth.md) gave a device a real identity
but no way to move data, so a second User still cannot open a shared Project.
[The Knowledge App specification](../knowledge-app-spec.md) requires this ADR to
choose the synchronization provider, offline merge, CRDT or equivalent, presence
protocol, revocation behavior, encrypted transport and storage, and shared
history retention before real-time collaboration is built.

Two constraints decide most of it. Simultaneous typing in one Page is a target,
which the existing expected-revision model cannot express: it detects a conflict
where collaborators expect a merge. And the project carries no hosting budget,
so a design that grows a bill as users arrive is not viable.

## Decision

**Yjs merges shared content.** A CRDT converges without a central arbiter, so two
devices that edited the same Page while apart reconcile on reconnect rather than
raising a conflict. Character-level `Y.Text` makes concurrent typing in one
paragraph merge instead of clobbering.

**Each group runs its own sync server.** MyBox ships a Worker template with a
Deploy to Cloudflare button; a User clicks it and gets a server on their own
Cloudflare account. Durable Objects are available on the Workers free plan, and
one Durable Object per Project gives the single coordination point a CRDT needs
for presence and persistence.

This is the decisive structural choice. No MyBox-operated server exists, so the
project holds no other person's data, carries no hosting cost, and cannot be
made to scale. A group's content stays on infrastructure that group controls,
which extends [ADR 0002](0002-local-first-tauri-workspace.md)'s local-first
stance rather than trading it away, and mirrors
[ADR 0017](0017-split-app-state-from-user-selected-project-stores.md): a local
Project names a User-selected directory, and a shared Project names a
User-selected sync endpoint.

**Only shared Projects sync.** A Project with no endpoint never leaves the
device, so choosing to collaborate is what puts content on a server.

**A member joins with an invite token and is then recorded by identity.** The
Owner issues a token, passes it through any channel, and the joining device
presents it once. The server stores that profile ID as a member, so the Owner
can later remove one person without disturbing anyone else — which a shared
passphrase cannot do.

**The server enforces Project roles.** Today
[ADR 0003](0003-agent-authorization-and-audit.md)'s role check runs in the
client, which is sufficient while the only writer is the person at the keyboard.
Once a peer can connect, a client check is advice: the server MUST reject a
write from a Viewer and from a removed member. The client keeps its check for
responsive UI, not as the boundary.

**Transport is TLS; content is not end-to-end encrypted.** The server belongs to
the group, so it is not an untrusted party in the way a vendor would be. E2EE
would also foreclose server-side search and validation while adding key
distribution that loses a Project when the key is lost.

**Presence uses Yjs awareness**, which carries cursor and identity as ephemeral
state that disappears on disconnect and is never persisted.

**The server retains current merged state plus a bounded recent update log.**
The 30-day Page history the specification requires stays an App-level record
derived locally. Persistence is debounced rather than written per keystroke,
because the free plan allows 100,000 row writes a day and typing would otherwise
exhaust it.

## Consequences

Collaboration requires one person in each group to deploy a server. That is a
real barrier the button reduces but does not remove, and it is the price of
having no hosting bill and no custody of other people's content.

A Yjs document becomes the authoritative form of a shared Page, so reads project
it back into the existing Page and Block shape. Operations and events stay the
public surface for Apps, Flows, and Agents, and personal Projects keep the
expected-revision model unchanged rather than paying CRDT overhead.

A group's server is a single point of failure for that group's live editing.
Because every device keeps a full local copy, a server outage stops
collaboration but never stops the owner from working.

The free tier is a ceiling, not a guarantee. A group that exceeds it sees writes
fail until the daily reset, and the honest remedy is their own paid plan.

## Deferred

End-to-end encryption, servers other than the Cloudflare template, cross-Project
links, moving a Project between endpoints, and any MyBox-operated hosting remain
undecided. Each needs its own ADR before it is built.

## Implementation notes

The server briefly existed in a separate
[mybox-sync-server](https://github.com/karladev001-eng/mybox-sync-server)
repository, because the Cloudflare deploy button a Project's Owner clicked
did not reliably deploy from a subdirectory of a monorepo and the split was
what made the button work at all.
[ADR 0024](0024-deploy-the-sync-server-through-the-cloudflare-api.md) replaced
that button with an API-token-driven deploy from MyBox itself, and as of
2026-08-18 the server lives back in this monorepo at `sync-server/`. It
implements one Durable Object per
Project, invite-token membership, and the role check enforced there rather than
only in the client. `mybox-app/src/knowledge/yjs-document.js` holds the shared
document model and applies `domain.js`'s mutation vocabulary to it, so a caller
does not branch on whether a Project is shared.

Character-level merge depends on sending the smallest edit rather than the whole
paragraph: replacing a Y.Text wholesale deletes characters a collaborator just
typed. `textDelta` computes that range and never splits a surrogate pair.

`mybox-app/src/knowledge/sync-client.js` runs the socket protocol,
`shared-project.js` holds a shared Project's live state and answers Page reads
in the same shapes the local store returns, and `src-tauri/src/sync_endpoints.rs`
claims or joins a Project and keeps the member token in OS credential storage.
Unlike an account token that token reaches the WebView, because the sync socket
carries it in its URL.

A shared Project accepts the editing mutations today. Tag changes and PageLink
creation still run through the local model and are refused with an explanation
rather than silently dropped. Presence is relayed but not yet drawn in the
editor, and two-device editing has been verified through the sync engine rather
than through the desktop UI.

As of 2026-08-19 the document sits behind the Operation boundary rather than
beside it. `KnowledgeView` originally called `shared.mutate()` and
`shared.readPage()` directly, bypassing `AppHost` whenever a Project was
shared. That made two write paths, and
[ADR 0025](0025-agent-operations-from-the-assistant-panel.md) then connected
the assistant to the other one: an assistant edit to a shared Project was
written to the JSON store, which the editor had stopped reading, so it
persisted correctly and was invisible forever. The live session is now injected
into `createKnowledgeApp({ sharedSessions })` as a port — the App cannot build
it, because it needs a socket — and `knowledge.page.read`, `page.list`, and
`page.update` resolve a shared Project through it. Every caller, the editor and
the assistant alike, goes through one path. `expectedRevision` accepts 0 for
this reason: a shared Page reports no revision, because a CRDT converges rather
than rejecting.
