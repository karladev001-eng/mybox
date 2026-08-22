# Authoring a MyBox App

This is the only document you need to create or change one App. It is
self-contained: the contract snippets below are the whole surface a handler
sees. You do not need to open `AGENTS.md`'s release section, the desktop/Tauri
bridge, another App's source, or anything under `src-tauri/` unless your task
explicitly touches releasing, native platform code, or cross-App integration.

If a decision here conflicts with what you read in the code, the code wins —
open an issue against this doc rather than guessing.

## What an App is

An App is a self-contained package: a manifest of Operations and Events, a set
of handlers, and its own storage namespace. The host (`mybox-app/src/core/`)
validates the manifest, authorizes every call, and routes it. An App never
reads or writes another App's storage, imports another App's internal modules,
or calls Tauri directly. Everything an App exposes to the rest of MyBox — the
UI shell, Workflows, and Agents — goes through its declared Operations and Events.

Background: `docs/app-framework.md` explains *why* the contract looks like
this. You do not need to read it to build an App; this document restates
everything a handler needs.

## Directory layout

Create `mybox-app/src/<app-id>/` with:

```
<app-id>/
  README.md        required — purpose, file list, what a reader needs to open
  app.js            App manifest + Operation handlers (the only host-facing file)
  domain.js         pure business rules: no React, no host, no storage calls
  client.js         thin Host client wrapper the UI calls (see below)
  <AppView>.jsx      the App's UI surface
  <app-id>.css      component styles, built only from tokens in ../styles.css
```

`domain.js` takes and returns plain state; `app.js` is the only file that
touches `storage`, `emit`, or `actor`. This split is not optional — it is what
lets `domain.js` be unit-tested without a host, and it is what the Knowledge
App (`mybox-app/src/knowledge/`) already does. Look there for a worked
example, but you do not need to read its files end to end — the shapes below
are the same in every App.

## `<app-id>` rules

- Lowercase slug, `^[a-z][a-z0-9-]*$` (e.g. `knowledge`, `task-board`).
- Every Operation and Event ID must be namespaced `<app-id>.<name>`
  (`knowledge.page.create`), and further dotted for grouping
  (`knowledge.page.history.read`).

## The manifest

```js
import { APP_SCHEMA_VERSION, defineApp } from "../core/app-contract.js";

export function createMyApp() {
  return defineApp({
    manifest: {
      schemaVersion: APP_SCHEMA_VERSION,   // currently 3 — copy this constant, never hardcode the number
      id: "my-app",
      name: "表示名",
      version: "0.1.0",                    // SemVer; bump on every behavior change
      hostCapabilities: ["app-storage"],    // declare what host features you use
      operations: [ /* operation({...}) entries, see below */ ],
      events: [ /* event declarations, see below */ ],
      connectors: { sources: [], targets: [] }, // optional typed App-to-App endpoints
      workflowActions: [ /* optional ordered Workflow steps, see below */ ],
    },
    handlers: {
      "my-app.thing.read"(input, ctx) { /* ... */ },
      // one handler per operation id — the host rejects a manifest/handlers mismatch
    },
  });
}
```

`defineApp` throws synchronously if any operation lacks a handler, any handler
has no matching operation, or an ID is not namespaced by `id`. There is no
way to register a broken manifest — trust the thrown error over guessing.

### Operations

An Operation is one request/response call. Every field below is required.

```js
function operation({ id, title, effect, confirmationClass, callers = ["user", "agent", "flow", "app"], inputSchema }) {
  return { id, title, effect, confirmationClass, callers, inputSchema, outputSchema: { type: "object" } };
}
```

- `effect`: one of `read`, `write`, `external`, `destructive`. Pick the
  smallest true effect — it drives audit logging and, for `destructive`,
  usually gates the caller list.
- `confirmationClass`: `review`, `recoverable`, `autonomous`, or
  `always-confirm`. This is compared against the User's device-wide
  Confirmation level for non-`user` callers; `always-confirm` can never be
  bypassed regardless of level.
  - `review`: read-only or fully inspectable before it runs.
  - `recoverable`: a write an Owner/Editor can undo (edit, move to Trash).
  - `autonomous`: destructive but reversible-in-spirit or low-risk enough to
    allow at the top Confirmation level (permanent delete with the ability to
    recreate, project deletion).
  - `always-confirm`: needs a fresh per-call approval no matter the level.
- `callers`: subset of `user`, `agent`, `flow`, `app`, `system`. Restrict a
  destructive or account-scoped Operation to `["user"]` if an Agent acting
  alone would be unsafe; the Knowledge App does this for
  `knowledge.project.delete` and `knowledge.profile.link-account`.
- `inputSchema` / `outputSchema`: JSON Schema, validated by Ajv before and
  after your handler runs. A handler that returns a shape the schema rejects
  fails the call even if the write already happened — write your schema to
  match your handler's actual return value.

### Events

```js
{
  id: "my-app.thing.changed",
  title: "Thing changed",
  payloadSchema: { type: "object", required: ["thingId"], properties: { thingId: { type: "string" } } },
}
```

Emit with `await ctx.emit("my-app.thing.changed", payload)` from inside a
handler. Only the declaring App may emit its own events; the host rejects
anyone else's attempt. Subscriber failures never roll back your write —
events describe completed facts, not two-phase transactions.

### The handler context

Every handler receives `(input, ctx)` where `ctx` is:

```js
{
  actor,          // { type: "user"|"agent"|"flow"|"app"|"system", id }
  appId,          // your app's id, already validated
  correlationId,
  storage,        // your app-scoped storage port, see below
  emit,           // (eventId, payload) => Promise<{ envelope, results }>
  invoke,         // (operationId, input, options) => Promise — call another App's Operation
  workflows,      // request(targetConnectorId) runs a typed App-request Workflow
  connections,    // legacy alias: pull(id) delegates to workflows.request(id)
  resources,      // read/import validated large-resource references
}
```

Call another App only through `ctx.invoke(...)`, never by importing its
`domain.js` or `app.js`. That call runs as an `app` actor and is subject to
the same authorization as any other caller.

### Connectors and resources

A Connector ID is App-namespaced. Sources use `mode: "pull"` with an
`operationId`, or `mode: "push"` with an `eventId`. Targets use
`mode: "pull"` for a library read through `ctx.workflows.request(id)`, or
`mode: "consume"` with an `operationId`. Both ends declare the same versioned
`dataType` and a JSON `configSchema`; `optionsOperationId` may provide settings
candidates. A saved Workflow grants only these named Operations. It does not
bypass caller types, Confirmation, or audit checks. `ctx.connections.pull(id)`
remains only as a compatibility wrapper while legacy Connection records migrate.

### Workflow Actions

An App can expose an Operation as an ordered Workflow step:

```js
{
  id: "my-app.workflow.publish",
  title: "公開する",
  operationId: "my-app.publish",
  inputDataType: "mybox.document.v1", // omit or null for a starting Action
  outputDataType: "mybox.result.v1",  // omit or null only for a final Action
  configSchema: { type: "object", properties: {} },
  optionsOperationId: "my-app.publish.options", // optional
}
```

The Operation must allow the internal `flow` caller. The Host invokes it with
`{item, config, trigger, runId, stepId, deliveryId, source}` and expects
`{item?}`. Workflow v1 passes the preceding Action's whole `item` only when the
versioned data types match exactly. A restricted Workflow JSON mapping may also
copy document fields into Operation input and validated result fields below
`$.data`; it does not provide expressions, filters, branches, loops, or parallel
execution. Use `deliveryId` or a stable source ID to make writes idempotent
because a crashed Step resumes with the same IDs.

The Host automatically presents a non-destructive Operation as a searchable
Workflow Command when its `callers` include both `agent` and `flow`, unless the
same Operation is already represented by an explicit Action or consume
Connector. A Command's saved configuration and optional JSON input mappings form
the Operation input; any typed item already moving through the Workflow passes
around it unchanged. The validated result is recorded in the one Workflow JSON
document and output mappings may copy fields into `$.data`. Publish a concrete
`outputSchema` so paths such as `$.pages[*].title` are discoverable. Keep an
Operation Agent-only to omit it from Workflows. Do not rely on automatic replay for a write
or external Command: after an interrupted invocation the Run stops for review,
because the original Agent API has no Workflow delivery ID. Use an explicit
Action when output typing or idempotent crash recovery matters.

Large binary content stays out of Operation JSON. Pass
`{appId, resourceId, mediaType, revision, name?}` and use the Host resource
broker. A consuming App imports bytes into its own namespace before persisting a
long-lived reference to them.

## Storage

`ctx.storage` is namespaced to your `appId` and cannot escape it — key
traversal (`../`, absolute paths, backslashes, empty segments) throws
`INVALID_STORAGE_KEY` before it reaches any driver.

```js
await storage.writeJson("state.json", value);   // value must be JSON-serializable
const value = await storage.readJson("state.json"); // null if never written
await storage.writeText("templates/one.md", markdown); // UTF-8, default 256 KiB max
const markdown = await storage.readText("templates/one.md"); // null if absent
await storage.delete("state.json");
const keys = await storage.list("");             // prefix match, sorted
```

There is no raw filesystem or database access from a handler. If your App
needs more than one JSON document, use more keys (`"state.json"`,
`"index.json"`) — do not reach for a different storage mechanism without
extending the host's storage port first, which is a framework change, not an
App change.

## Registering the App

Add one entry to `mybox-app/src/apps/registry.js`'s `builtInDefinitions`:

```js
{
  id: "my-app",
  version: "0.1.0",       // installed-catalog SemVer; raise when the App changes
  name: "表示名",
  icon: "note",            // a key in App.jsx's iconMap, see below
  color: "#RRGGBB",         // six-digit hex
  hint: "一覧に出る短い説明",
  builtIn: true,
  defaultInstalled: true,   // false if Users must add it explicitly
  shortcuts: [{             // optional; active only while this App is selected
    id: "find-item",
    group: "My App",
    label: "項目を検索",
    key: "f",
    code: "KeyF",
    displayKeys: ["Ctrl", "F"],
  }],
  surface: {
    kind: "module",
    load: () => import("../my-app/MyAppView.jsx"),
    exportName: "MyAppView",
  },
}
```

Shortcut IDs are unique lowercase slugs within the App. The Host keeps its
reserved bindings, resolves the selected App's descriptors after Host commands,
lists them in the command palette, and passes `{ shortcutId, sequence }` to the
Surface as `shortcutCommand`. Handle that prop in the Surface; do not add a
second window-global key listener.

`AGENTS.md`'s release section applies from here: raise this `version` every
time the App's behavior changes, or installed Users never see an update. That
version and the manifest's `version` are two different device-facing numbers
(installed-catalog version vs. contract version) — keep both current, but
they do not have to move in lockstep.

`icon` is not validated against a fixed enum by the registry, but the launcher
UI resolves it through `iconMap` in `mybox-app/src/App.jsx`; an unrecognized
key silently renders a generic fallback glyph instead of erroring. Reuse one
of the existing keys there. If none fits, adding a new one is a small,
mechanical edit to that one map — it is the only shared top-level file a new
App's registration ever needs to touch, and it is limited to adding one
`iconKey: SomeIcon` line.

## The client wrapper

`client.js` is the only file your UI imports for host calls. It exists so the
UI never constructs `AppHost` or picks a storage driver itself:

```js
import { LOCAL_PROFILE_ID } from "../core/account-identity.js";
import { AppHost } from "../core/app-host.js";
import { MemoryStorageDriver } from "../core/storage.js";
import { TauriStorageDriver } from "../desktop/tauri-storage.js";
import { createMyApp } from "./app.js";

const webDriver = new MemoryStorageDriver();

export function createMyAppClient({ desktop = false, getProfileId = () => LOCAL_PROFILE_ID } = {}) {
  const host = new AppHost({ storageDriver: desktop ? new TauriStorageDriver() : webDriver });
  host.register(createMyApp());
  const invoke = (operationId, input = {}) => host.invoke(operationId, input, {
    actor: { type: "user", id: getProfileId() || LOCAL_PROFILE_ID },
  });
  return Object.freeze({
    readThing: (id) => invoke("my-app.thing.read", { id }),
    // one method per operation
  });
}
```

This is the only place `desktop/tauri-storage.js` may be imported from. If
your App needs a native capability beyond storage (OS credential store, a
platform dialog, a network call outside the WebView), that is a
`desktop/`-bridge change, which is out of this document's scope — read
`mybox-app/src/desktop/README.md` only when you actually need one.

## UI rules

Read `FRONTEND.md`'s **Tokens** section before writing CSS — that is the only
part of it an App author needs. Use the CSS custom properties defined in
`mybox-app/src/styles.css` (`--surface`, `--text`, `--accent`, `--space-*`,
`--radius-*`, etc.); do not invent a new raw color, radius, or spacing value
where a token already names that role. Reuse `mybox-app/src/ThemedSelect.jsx`
for any dropdown/listbox instead of a native `<select>` — native popup
chrome cannot be fully themed and reads as a bug.

Keep domain rules out of the view component. `MyAppView.jsx` calls
`client.js`, renders what comes back, and sends user intent back through
`client.js`. Validation, merge behavior, and invariants belong in `domain.js`.

## Testing

Add `mybox-app/tests/<app-id>-app.test.mjs` using Node's built-in
`node:test` + `node:assert` (see `tests/knowledge-app.test.mjs` for the
pattern: no framework, no mocks beyond `MemoryStorageDriver`). Cover:

- `domain.js` invariants directly, with no host involved.
- Operations end-to-end through a fresh `AppHost` with your app registered —
  confirms schema validation and authorization, not just your handler logic.

Then add your test file to the `test:core` script in
`mybox-app/package.json` so `npm test` runs it, and add one line to
`mybox-app/tests/README.md` describing what it covers.

## Required docs for a new App

Per the repository-wide `AGENTS.md`: your App's directory needs a
`README.md` (purpose, file list, what a reader needs to open — model it on
`mybox-app/src/knowledge/README.md`), and if the App introduces a genuinely
new architectural, product-behavior, data, security, or workflow decision, it
needs an ADR in `docs/adr/`. Implementing a decision this document or
`docs/app-framework.md` already made does not need a new ADR.

## Checklist before calling an App done

- [ ] `app.js` is the only file touching `storage`, `emit`, `actor`, or
      another App's Operations.
- [ ] `domain.js` has no React, host, or storage imports — it is pure
      functions over plain data.
- [ ] Every Operation picks the smallest true `effect` and the right
      `confirmationClass`; anything destructive or account-scoped has a
      deliberate `callers` list, not the default four.
- [ ] Every Operation's `outputSchema` actually matches what the handler
      returns.
- [ ] No import of `../desktop/tauri-storage.js` (or any other
      `desktop/*` module) outside `client.js`.
- [ ] No hardcoded color/radius/spacing where `styles.css` already has a
      token; no native `<select>`.
- [ ] `mybox-app/src/<app-id>/README.md` exists and lists every file.
- [ ] `mybox-app/tests/<app-id>-app.test.mjs` exists and is wired into
      `test:core`.
- [ ] The registry entry's `version` and the manifest's `version` both moved
      if behavior changed.
- [ ] `npm test` and `npm run build` (from `mybox-app/`) both pass.

## What you never need to read for App work

Unless your task explicitly says otherwise: `src-tauri/` (native Rust),
`mybox-app/src/desktop/*` beyond the one bridge file your `client.js` needs,
`docs/adr/*` other than an ADR you are actively updating, the release steps
in the repository-root `AGENTS.md`, and any other App's `domain.js`,
`app.js`, or view component. If a task turns out to need one of these, that
is a signal the task is no longer "implement one App" — say so rather than
reading the whole repository to be sure.
