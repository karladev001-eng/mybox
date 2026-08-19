# Knowledge App

Implements the first vertical slice of the `knowledge` App described in
`../../../docs/knowledge-app-spec.md`.

- `domain.js`: runtime-neutral Project, Page, Block, PageLink, Tag, Trash,
  revision, history, and search rules.
- `app.js`: public App manifest and Operation handlers backed by App storage.
- `client.js`: User-facing Host client used by the React surface. It is the
  only file in this directory allowed to import a `../desktop/*` bridge
  module (sync endpoints, Cloudflare, images, the URL opener, Tauri storage);
  `KnowledgeView`
  and every other file here call its wrapper methods instead, per
  `docs/app-authoring.md`. Also registers its `AppHost` into
  `core/agent-host-registry.js` so the assistant panel can invoke this App's
  Operations ([ADR 0025](../../../docs/adr/0025-agent-operations-from-the-assistant-panel.md)).
- `KnowledgeView.jsx`: accessible desktop knowledge workspace.
- `editor-behavior.js`: pure Markdown conversion and grouped-list editing rules.
  `markdownConversion` handles one line as the User types; `parseMarkdownBlocks`
  is its document-level counterpart, turning a whole Markdown text into typed
  Blocks for the `markdown-set` mutation. Consecutive bullets or numbers become
  one list Block, matching how list items are stored as newline-separated text.
- `yjs-document.js`: the shared representation of a Project. Applies the same
  mutation vocabulary as `domain.js` to a Yjs document and projects it back into
  the Page and Block shape, so a shared Project merges concurrent edits where a
  local one reports a revision conflict.
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
