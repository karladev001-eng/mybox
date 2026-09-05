# Knowledge App

Implements the mandatory Knowledge record foundation described in
`../../../docs/knowledge-app-spec.md`.

- `domain.js`: runtime-neutral Project, member author color, Page, Block,
  PageLink, Tag, Trash, revision, history, and search rules.
- `author-color.js`: the accessible member color palette, neutral default, and
  common visibility rule used by local and Cloudflare-shared Projects.
- `member-profile.js`: presentation-only member deduplication and account-name
  resolution; the stored local membership remains intact for signed-out access.
- `app.js`: public App manifest, Connector and Workflow Action declarations, and Operation handlers
  backed by App storage. Tagged Markdown Pages can supply Image Prompt templates;
  non-destructive Agent Operations shared with the Flow caller appear as visual
  Workflow Commands, including always-confirm Project creation. Project, Page,
  search, Markdown, and Tag reads publish concrete output schemas so Workflow
  JSON mappings can offer fields such as Page titles;
  `knowledge.page.markdown.read` exposes an authorized Page body for explicit
  imports without exposing Knowledge storage or requiring a saved Connection;
  generated-image delivery is idempotent by both delivery ID and source
  generation ID, and copies media into Knowledge storage
  before creating an image Block.
- `client.js`: User-facing Host client used by the React surface. It is the
  only file in this directory allowed to import a `../desktop/*` bridge
  module (sync endpoints, Project stores, Cloudflare, images, the URL opener,
  Tauri storage);
  `KnowledgeView`
  and every other file here call its wrapper methods instead, per
  `docs/app-authoring.md`. Also registers its `AppHost` into
  `core/agent-host-registry.js` so the assistant panel can invoke this App's
  Operations ([ADR 0025](../../../docs/adr/0025-agent-operations-from-the-assistant-panel.md)).
  If an in-place Surface update reaches an older live Host that does not yet
  expose the optional resume-position Operations, it treats that state as empty
  and continues loading Projects instead of presenting a false empty workspace.
- `KnowledgeView.jsx`: accessible desktop knowledge workspace.
  On open it restores the current profile's last accessible Project and Page;
  a shared Project session is prepared before the saved Page is validated.
  It receives Host-dispatched App shortcut commands, focuses Page search for
  `Ctrl+P`, shows a Page-search combobox whose candidates cycle with Tab and
  open with Enter, and renders online collaborators beside history without exposing
  immutable profile IDs as account names. Multiline clipboard text and Markdown
  files are submitted as one structural paste, then focus continues in the last
  pasted Block. Persistent navigation uses section dividers instead of nested
  card outlines, while repeated Page and Block actions are icon-only controls
  with accessible names and themed pointer/focus tooltips. Block selection uses
  a pressed control plus an explicit action bar; its selection control and
  Ctrl/Cmd-click toggle Blocks, Shift-click extends a range, and successful single or bulk deletions can be restored with
  the visible action or `Ctrl+Z` while focus is outside a native text editor.
- `search-behavior.js`: normalized Page candidate filtering and pure keyboard
  actions for the search combobox.
- `tag-behavior.js`: IME-safe half-width/full-width Space delimiter detection
  and live, used-only candidate filtering for the Tag combobox. Space keeps the
  combobox focused for sequential entry; Enter commits and exits the field.
- `editor-behavior.js`: pure Markdown conversion, Tab indentation, grouped-list
  editing, Block-selection, and deletion-restore anchor rules.
  `markdownConversion` handles one line as the User types; `parseMarkdownBlocks`
  is its document-level counterpart, turning a whole Markdown text into typed
  Blocks for the `markdown-set` mutation. Consecutive bullets or numbers become
  one list Block, matching how list items are stored as newline-separated text.
  Clipboard parsing additionally treats ordinary hard line breaks as Block
  boundaries and preserves the source Block text around the pasted selection.
- `yjs-document.js`: the shared representation of a Project. Applies the same
  mutation vocabulary as `domain.js` to a Yjs document and projects it back into
  the Page and Block shape, so a shared Project merges concurrent edits where a
  local one reports a revision conflict. It also syncs member colors and the
  last account to edit each Page and Block.
  Non-secret display names and HTTPS avatar URLs form a shared profile directory
  so author labels remain readable after a collaborator disconnects.
- `shared-project.js`: a shared Project's live state. Owns the document and its
  sync client, and answers Page reads in the same shapes the local store does.
  It takes `domain.js`'s mutation vocabulary and converts to the document's own,
  so callers never speak a second dialect. `client.js` registers the live
  session with the Host runtime and keeps it available across App surface
  changes; Operations from Note, Image, and Agents resolve a shared Project
  through that one port. Nothing outside that path writes to the
  document — two write paths are what once made assistant edits invisible
  ([ADR 0023](../../../docs/adr/0023-user-operated-sync-servers-with-yjs.md)).
  Page creation, Trash-aware listing, Project Page counts, Trash transitions,
  restore, and owner purge use this same live document, so a stored Page never
  remains hidden in or conflicts with the local JSON model.
  PageLink completion also creates its missing target Page in the same Yjs
  transaction, preserving the local model's Project-wide title uniqueness.
  Tag definitions and Page assignments also live in that document; shared Tag
  creation, removal, candidates, counts, and Tag-name search converge for peers.
  It also encodes every local Page, including Trash, into the full Yjs snapshot
  written before an unshared Project changes storage location. Existing Projects
  that have no store are seeded into `apps/knowledge/<Project name>` when stores
  are first listed.
- `sync-client.js`: keeps that document in step with a Project's sync endpoint.
  Relayed updates carry a remote origin so they are never echoed back, and a
  Viewer sends nothing because the server would refuse it anyway.
- `project-store-client.js`: persists the same Yjs document through bounded,
  append-only update files in MyBox or a User-selected Google Drive, OneDrive,
  Dropbox, Syncthing, or similar desktop folder. Each Project uses its own
  Project-named directory. It receives opaque update
  records from `client.js` and never receives a native path. The Cloudflare
  client may run beside it on the same document.
- `knowledge.css`: Knowledge App layout and component states using root tokens.

Keep domain rules out of React. Other Apps and Agents must use the Operations in
`app.js`; they must not import or mutate stored state directly.

- `records.js`: Conversation and Context record mutations, immutability and provenance.
- `record-operations.js`: versioned record Operations and authorized live-Project projections.

- `context-records.js`: v2 Context notebooks, turn outcomes, cross-Project source
  authorization, preview tokens and immutable shared copies with embedded media.
- `ContextNotebook.jsx`: turn details, source navigation, selection and shared-copy
  preview. Old Context Pages remain readable through the same component.

Context notebook reads automatically resolve the session-conversation link with
current title and source access checks, including existing Context records.

- `record-links.js`: idempotent automatic PageLinks for Conversation, Context, legacy records and actual sources; authorized cross-Project backlinks.
