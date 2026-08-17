# Knowledge App

Implements the first vertical slice of the `knowledge` App described in
`../../../docs/knowledge-app-spec.md`.

- `domain.js`: runtime-neutral Project, Page, Block, PageLink, Tag, Trash,
  revision, history, and search rules.
- `app.js`: public App manifest and Operation handlers backed by App storage.
- `client.js`: User-facing Host client used by the React surface.
- `KnowledgeView.jsx`: accessible desktop knowledge workspace.
- `editor-behavior.js`: pure Markdown conversion and grouped-list editing rules.
- `yjs-document.js`: the shared representation of a Project. Applies the same
  mutation vocabulary as `domain.js` to a Yjs document and projects it back into
  the Page and Block shape, so a shared Project merges concurrent edits where a
  local one reports a revision conflict.
- `knowledge.css`: Knowledge App layout and component states using root tokens.

Keep domain rules out of React. Other Apps and Agents must use the Operations in
`app.js`; they must not import or mutate stored state directly.
