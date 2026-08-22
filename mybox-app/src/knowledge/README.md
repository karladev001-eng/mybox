# Knowledge App

Implements the first vertical slice of the `knowledge` App described in
`../../../docs/knowledge-app-spec.md`.

- `domain.js`: runtime-neutral Project, member author color, Page, Block,
  PageLink, Tag, Trash, revision, history, and search rules.
- `author-color.js`: the accessible member color palette and deterministic
  fallback used by local and shared Projects.
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
  module (sync endpoints, Cloudflare, images, the URL opener, Tauri storage);
  `KnowledgeView`
  and every other file here call its wrapper methods instead, per
  `docs/app-authoring.md`. Also registers its `AppHost` into
  `core/agent-host-registry.js` so the assistant panel can invoke this App's
  Operations ([ADR 0025](../../../docs/adr/0025-agent-operations-from-the-assistant-panel.md)).
- `KnowledgeView.jsx`: accessible desktop knowledge workspace.
  It receives Host-dispatched App shortcut commands, focuses Page search for
  `Ctrl+P`, shows a Page-search combobox whose candidates cycle with Tab and
  open with Enter, and renders online collaborators beside history without exposing
  immutable profile IDs as account names. Multiline clipboard text and Markdown
  files are submitted as one structural paste, then focus continues in the last
  pasted Block. Persistent navigation uses section dividers instead of nested
  card outlines, while repeated Page and Block actions are icon-only controls
  with accessible names and themed pointer/focus tooltips.
- `search-behavior.js`: normalized Page candidate filtering and pure keyboard
  actions for the search combobox.
- `tag-behavior.js`: IME-safe half-width/full-width Space delimiter detection
  and live, used-only candidate filtering for the Tag combobox. Space keeps the
  combobox focused for sequential entry; Enter commits and exits the field.
- `editor-behavior.js`: pure Markdown conversion, Tab indentation, and grouped-list editing rules.
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
  so callers never speak a second dialect. `KnowledgeView` hands the live
  session to `client.js`, which passes it to `app.js` as a port; Operations then
  resolve a shared Project through it. Nothing outside that path writes to the
  document — two write paths are what once made assistant edits invisible
  ([ADR 0023](../../../docs/adr/0023-user-operated-sync-servers-with-yjs.md)).
- `sync-client.js`: keeps that document in step with a Project's sync endpoint.
  Relayed updates carry a remote origin so they are never echoed back, and a
  Viewer sends nothing because the server would refuse it anyway.
- `knowledge.css`: Knowledge App layout and component states using root tokens.

Keep domain rules out of React. Other Apps and Agents must use the Operations in
`app.js`; they must not import or mutate stored state directly.
