# MyBox App Framework

## Package contract

Each app is a trusted package registered with the host. Its manifest contains:

- stable app ID and semantic version;
- operation and event contracts expressed as JSON Schema;
- each operation's effect: `read`, `write`, `external`, or `destructive`;
- allowed callers: `user`, `agent`, `flow`, `app`, or `system`;
- required host capabilities such as app storage, file selection, network access,
  secrets, or notifications.

Operation and event IDs are globally namespaced with the app ID, such as
`notes.read` and `notes.created`. Contract changes are backward compatible within
a major version. Breaking changes use a new major contract or a new ID.

An app may be disabled or unregistered at runtime. The host then removes its
operations and event declarations. Consumers must treat `not found`, `disabled`,
`permission denied`, schema failure, timeout, and cancellation as normal outcomes.

## Operations and events

Operations are asynchronous request/response calls routed by the host. The host
validates input and output, authorizes the actor, invokes the handler, and records
audit metadata without logging payload contents.

Events describe completed facts. The emitting app validates the payload against
its manifest before publication. Subscriber failure does not roll back the
operation that emitted the event; retries and compensation belong to the flow or
subscriber. Cross-app atomic transactions are intentionally unsupported.

Large files are passed as resource references rather than embedded payloads. A
reference contains an opaque URI, media type, revision, and optional display
metadata; the host resolves it after checking the caller's grant.

## State and storage

The user-selected workspace directory is authoritative. The host gives each app a
storage port scoped to its app ID; keys cannot escape that namespace. Apps must not
open another app's directory or depend on its on-disk representation.

The target desktop layout is:

```text
<workspace>/
  .mybox/             host metadata, registry, grants, audit and flow definitions
  apps/<app-id>/      private state owned by one app
  resources/          host-managed large resources and revisions
```

The JavaScript memory driver is for tests and the Web prototype. The Tauri driver
implements app-scoped JSON reads and atomic replacement in the selected workspace;
OS-backed secret storage remains a future host adapter. Google Cloud and other providers are opt-in adapters
for import, export, backup, or synchronization. They do not become direct shared
state between apps.

## Agent and flow access

Agents and flows discover only manifest operations that list their caller type.
The default authorization policy is:

- reads may run after the user has granted the app/data scope;
- writes require an explicit approval or a revocable scoped session grant;
- destructive and external effects require a fresh confirmation;
- every invocation records actor, operation, effect, timestamp, correlation ID,
  duration, and outcome, but not raw inputs or outputs.

Flows persist operation IDs, contract major versions, input mappings, and grants.
They pause with an actionable error when an app is missing, disabled, incompatible,
or no longer authorized.

## Example: note to slide

1. The agent invokes `notes.read` with a note ID.
2. The host checks the note read grant and returns validated Markdown.
3. The agent invokes `slides.generate` with the content and a source reference.
4. The slide app stores the result in its own namespace and emits
   `slides.generated`.
5. The generated document keeps the source note ID and revision so staleness can
   be detected without reading note internals.

## Implementation boundary

`mybox-app/src/core/` is the host-independent reference implementation. React is a
client of that layer. `mybox-app/src/desktop/` bridges core storage to Tauri, while
`mybox-app/src-tauri/` owns native dialogs and filesystem commands. Future secret
and cloud adapters stay behind the same host boundary; app handlers must not call
Tauri APIs directly.
