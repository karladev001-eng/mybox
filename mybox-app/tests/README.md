# Tests

`npm test` needs no server. `npm run test:sync` drives two real sync clients
against a running instance of [`sync-server`](../../sync-server) (`npm run dev`
there first) and is the only place the client, the wire protocol, and the
server meet.

Contains Node tests for framework behavior and Sites packaging.

- `context-preview.html` / `context-preview.jsx`: manual dark UI fixture served
  by Vite at `/tests/context-preview.html`. Exercises real in-memory Context
  Operations and a simulated sharing destination, without provider/network writes.
- `knowledge-records.test.mjs`: record migration, Context notebooks, preferences,
  source/destination authorization, frozen sharing and embedded media convergence.

- `app-host.test.mjs`: operation/event contracts, agent authorization, auditing,
  app removal, and state isolation.
- `agent-runtime.test.mjs`: the provider decision loop, Operation grants, and
  the Confirmation-level approval gate — denied by default above a caller's
  level, granted through the `onApprovalNeeded` callback with the model's own
  input previewed first.
- `agent-host-registry.test.mjs`: registering and forgetting an App's host by
  ID, and the aggregate host that unions Operations across every registered
  App and routes a call by its ID's App-prefix.
- `chat-history.test.mjs`: provider-neutral chat session state, bounded context,
  app-scoped persistence, validated skill/generated-image references, and safe
  model/reasoning/token-usage metadata.
- `knowledge-app.test.mjs`: Project/Page/Block invariants, PageLink and Trash
  transitions, title uniqueness, roles, member colors, Tab indentation,
  revisions, search, and App Operations.
- `project-store-client.test.mjs`: append-only Project-store convergence,
  pulled update de-duplication, and retry after a store becomes unavailable.
- `shared-project.test.mjs`: live shared-Project behavior plus full local Page
  snapshots used when a Project store moves, including shared Trash, restore,
  and owner purge behavior.
- `app-registry.test.mjs`: validated versioned App definitions, SemVer update
  checks, installation migration and persistence, duplicate protection, built-in
  defaults, and extensible lazy Surface contracts.
- `keyboard-shortcuts.test.mjs`: Host shortcut resolution, modifier and physical
  key matching, availability while an editable control is focused, and palette
  commands for installed Apps and MyBox home.
- `host-session.test.mjs`: validated Host last-surface persistence, including
  fallback when an App is no longer installed.
- `workflows.test.mjs`: durable typed Workflow migration, Agent Operation
  projection, pass-through Commands, event ordering, approval resume, safe
  command crash recovery, retry limits, Step snapshots, and schedule catch-up.
- `tag-behavior.test.mjs`: IME-safe physical/full-width Space confirmation,
  composition-end delimiter detection, multi-Tag splitting, and used-only
  candidate filtering.
- `search-behavior.test.mjs`: normalized Page candidate filtering and
  Tab/Shift+Tab/Enter/Escape behavior for the Note search combobox.
- `sites-worker.test.mjs`: static asset fallback and required build outputs.

Run `npm test` for framework tests. Run `npm run build` before `npm run test:sites`
because the Sites test checks generated package files.

- `message-markdown.test.mjs`: semantic GFM output and blocked HTML, unsafe links
  and implicit remote media. The Context preview also shows rich message rendering.

The Context preview supports `?workspace&sameProject` for reciprocal PageLink verification and `?workspace` for cross-Project backlink navigation using the actual KnowledgeView and in-memory records.

The Context preview also accepts `?workspace&library` for Folder and File UI checks. Record tests cover hierarchy, immutable originals, persistence failures and access checks; sync live tests cover original upload/read and hash failures.

`themes.test.mjs` checks preference restart/concurrency/failure behavior and palette text contrast.

- `image-records.test.mjs`: Image record migration, original verification, restart, input-before-provider persistence and permissions.

- `record-graph.test.mjs` checks cross-Project identity, direction, duplicate links, access denial, Trash, storage failure and multi-page neighborhoods.

`editor-async.test.mjs` covers delayed writes, navigation intent, revision ordering and pending/error recovery.

`interaction-preview.html` mounts the actual Knowledge view in an isolated in-memory
runtime. Run the Vite dev server and open `/tests/interaction-preview.html` for
manual delayed-save, failed-save, keyboard navigation and theme verification.
This fixture never calls native providers or production storage.

`image-history-preview.html` mounts the actual Image view to verify built-in
sample shelves during a history failure and reopening a migrated history copy.
An optional local JSON snapshot is read into browser memory only; record writes
and provider calls are disabled. Never commit real snapshots or originals.
