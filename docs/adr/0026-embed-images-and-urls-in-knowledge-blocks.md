# ADR 0026: Embed images and URLs in Knowledge Blocks through opaque resource IDs

- Status: Accepted
- Date: 2026-08-18

## Context

[ADR 0012](0012-own-the-knowledge-graph-in-mybox.md) shipped the first Block
types and deferred the rest: "Tables, images, attachments, and embedded content
are deferred until the host has the required resource-storage support and their
round-trip behavior is decided." Both halves of that condition have since been
answered elsewhere. `src-tauri/src/codex.rs` already stores the AI chat's
generated images under an App-private namespace and hands the WebView an opaque
resource ID rather than a filesystem path, so the storage pattern exists and has
a precedent to copy. What remained undecided was how a Block carries such a
reference without the Block schema growing a field that only two Block types
ever populate.

That schema question is not cosmetic. A Block's shape is load-bearing in three
places that would each need migrating: `knowledge/domain.js`'s mutation
validation, `knowledge/yjs-document.js`'s CRDT projection
([ADR 0015](0015-prepare-blocks-for-future-realtime-collaboration.md)), and the
30-day Page history snapshots ADR 0012 promises to keep restorable. A new
optional field means every existing stored Page, every peer running an older
build, and every retained history snapshot has to agree about its absence.

## Decision

**An embedding Block reuses `text` as its payload instead of adding a field.**
A `url-embed` Block's `text` is the URL; an `image` Block's `text` is the opaque
resource ID, optionally suffixed `?w=<percent>` once the User resizes it. Every
Block keeps one shape, so `domain.js`, the Yjs projection, and history snapshots
need no migration and an older peer degrades to showing the raw string rather
than losing the Block. The cost is that `text` is no longer uniformly
human-authored prose, and a future embedding type with genuinely structured
metadata will have to revisit this rather than encode ever more into one string.

**The frontend only ever sees an opaque resource ID, never a filesystem path**,
matching `codex.rs`. `store_knowledge_image` / `store_knowledge_image_bytes`
write into the Knowledge App's own private namespace and return an ID;
`read_knowledge_image` resolves it back to a data URI. The native side
validates the ID against traversal and extension before touching the
filesystem, sniffs magic numbers rather than trusting a declared type, bounds
the size, and writes atomically. This keeps
[ADR 0002](0002-local-first-tauri-workspace.md)'s rule that raw filesystem
access never crosses into app modules — an App owning private state does not
mean an App addressing the disk.

**The window turns Tauri's native drag-drop off (`dragDropEnabled: false`) and
handles a dropped file as ordinary HTML5 `dataTransfer.files`.** With it on,
WebView2 intercepts drag events natively and the browser's own drag-and-drop
state machine breaks: dragging a Block to reorder it shows a "not allowed"
cursor and the drop is refused. Block reordering is the older, more frequently
used behavior, and it is pure DOM; image drop is the newcomer and already has a
bytes-based path built for clipboard paste
(`store_knowledge_image_bytes`), so it costs nothing to serve both from one
handler. The native path-based drop event is dropped entirely rather than kept
as a second code path.

**The opener capability grants both `opener:allow-open-url` and
`opener:allow-default-urls`.** The first exposes the command but carries an
empty URL scope, so on its own every call is refused with "Not allowed to open
url" — which is what a `url-embed` Block did. The second supplies the scope
permitting `http:`, `https:`, `mailto:`, and `tel:`. Path opening and
`reveal-item-in-dir` stay ungranted, keeping this narrower than
`opener:default`.

## Consequences

- An `image` Block's `text` is not prose, so anything that reasons about Block
  text generically sees an opaque ID. Local search
  ([ADR 0014](0014-search-authorized-blocks-locally-before-embeddings.md))
  indexes it as such; it will not match on image content, which is correct but
  means an image contributes nothing to finding the Page containing it.
- A resource is referenced by ID, not owned by the Block. Deleting the Block, or
  purging the Page, does not currently delete the stored bytes — a purge
  therefore leaves the image file behind. Reference-counted cleanup is not built
  here.
- Images are stored per-App and per-device. A shared Project
  ([ADR 0023](0023-user-operated-sync-servers-with-yjs.md)) syncs the Block, so
  a peer receives an `image` Block whose resource ID resolves to nothing on
  their device and renders the "画像を読み込めません" state. Syncing the bytes
  themselves is a separate decision.
- Turning off native drag-drop removes the ability to accept a file dropped
  anywhere on the window regardless of what is mounted. Only a surface that
  wires its own DOM handler accepts drops now; today that is the Knowledge
  Blocks list.
- Because `?w=` is parsed out of `text`, a resource ID may never legitimately
  contain `?`. The native ID validator already rejects it, so the encoding and
  the validator have to stay consistent — a laxer ID format later would silently
  break width parsing.
- Granting the opener a URL scope means a Block can open any `http(s)` URL the
  User typed into it in their real browser. The URL is User-authored content in
  their own Page, and it leaves the WebView rather than rendering inside it, so
  this does not widen what the WebView itself will load — the app still runs
  with no CSP, which remains the open item from `AGENTS.md`.

## Authoring a whole Page at once

Structural mutations are one unit per call, which suits an editor and defeats an
agent: writing a short structured Page costs a `block-add` per Block, and
[ADR 0025](0025-agent-operations-from-the-assistant-panel.md)'s step budget runs
out before the document does. Asked to summarise into a Page, the assistant
therefore wrote an entire document — headings and bullets hand-drawn as `■` and
`・` — into one paragraph Block, which is what the Blocks model exists to avoid.

The `markdown-set` mutation takes a whole Markdown document and MyBox parses it
into typed Blocks (`parseMarkdownBlocks`). The Block vocabulary was already
Markdown-shaped, both per line (`#`, `-`, `1.`, `>`, ```` ``` ````, `---`, `$$`)
and inline (`**bold**`, `$math$`), so this reuses the conventions the editor
already teaches rather than inventing an import format. Structure becomes the
parser's job instead of a model's discipline, and one call replaces a dozen.

It appends by default. Replacing a Page is the more useful behaviour when
rewriting and the more damaging one when the model misjudges, and Page history
is a recovery path rather than a reason to be careless; `mode: "replace"` is
therefore explicit. A Page still holding only its initial empty Block is the one
exception, replaced rather than appended to, so a generated document does not
open with a blank line.

## Deferred

PDF embedding is the next stage and is intended to render through the browser's
own PDF viewer rather than a bundled renderer, but is not built here. Reference
-counted resource cleanup on Block or Page deletion, syncing image bytes to a
shared Project's peers, images in Markdown round-tripping, tables, and non-image
attachments remain undecided.

## Implementation notes

As of 2026-08-18: `knowledge/domain.js`'s `BLOCK_TYPES` gained `url-embed` and
`image`. `knowledge/editor-behavior.js` converts a Block whose whole text is a
bare URL into a `url-embed`. `src-tauri/src/knowledge_resources.rs` implements
the three commands, reusing `codex.rs`'s `detect_image` (widened to
`pub(crate)`), capping at 25 MB, and persisting through a `NamedTempFile`.
`src/desktop/knowledge-images.js` is the only bridge module involved and is
imported solely by `knowledge/client.js`, per the App boundary in
`docs/app-authoring.md`. `KnowledgeView.jsx` inserts an image from the picker, a
clipboard paste (a document-level `paste` listener, since a `paste` only reaches
listeners the focused element bubbles through), or an HTML5 file drop on the
Blocks list, and resizes one by dragging a corner handle that commits once on
release. `src-tauri/tauri.conf.json` sets `dragDropEnabled: false`;
`src-tauri/capabilities/default.json` adds `opener:allow-default-urls`.
