# Knowledge App

Implements the first vertical slice of the `knowledge` App described in
`../../../docs/knowledge-app-spec.md`.

- `domain.js`: runtime-neutral Project, Page, Block, PageLink, Tag, Trash,
  revision, history, and search rules.
- `app.js`: public App manifest and Operation handlers backed by App storage.
- `client.js`: User-facing Host client used by the React surface. It is the
  only file in this directory allowed to import a `../desktop/*` bridge
  module (profile preferences, sync endpoints, Tauri storage); `KnowledgeView`
  and every other file here call its wrapper methods instead, per
  `docs/app-authoring.md`.
- `KnowledgeView.jsx`: accessible desktop knowledge workspace.
- `editor-behavior.js`: pure Markdown conversion and grouped-list editing rules.
- `yjs-document.js`: the shared representation of a Project. Applies the same
  mutation vocabulary as `domain.js` to a Yjs document and projects it back into
  the Page and Block shape, so a shared Project merges concurrent edits where a
  local one reports a revision conflict.
- `shared-project.js`: a shared Project's live state. Owns the document and its
  sync client, and answers Page reads in the same shapes the local store does,
  so `KnowledgeView` reads one or the other without branching on shape.
- `sync-client.js`: keeps that document in step with a Project's sync endpoint.
  Relayed updates carry a remote origin so they are never echoed back, and a
  Viewer sends nothing because the server would refuse it anyway.
- `knowledge.css`: Knowledge App layout and component states using root tokens.

Keep domain rules out of React. Other Apps and Agents must use the Operations in
`app.js`; they must not import or mutate stored state directly.
