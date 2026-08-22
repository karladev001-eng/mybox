# Tests

`npm test` needs no server. `npm run test:sync` drives two real sync clients
against a running instance of [`sync-server`](../../sync-server) (`npm run dev`
there first) and is the only place the client, the wire protocol, and the
server meet.

Contains Node tests for framework behavior and Sites packaging.

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
