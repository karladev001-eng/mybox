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
the native provider adapter stores API secrets in the OS credential store. Google
Cloud and other providers are opt-in adapters
for import, export, backup, or synchronization. They do not become direct shared
state between apps.

## Agent and flow access

Agents and flows discover only manifest operations that list their caller type.
An agent's model is supplied through a replaceable agent provider. The provider
receives prompt/context data and returns text or a structured decision; it never
receives an app storage port or raw workspace path. Subscription authentication,
API credentials, and local inference are distinct provider modes and must not be
silently substituted for one another.

The initial ChatGPT subscription adapter uses the native Codex App Server and
accepts Codex-managed ChatGPT authentication without hardcoding a plan tier.
Codex owns credentials and refresh. MyBox treats provider output as untrusted
input and converts requested actions into normal host operation calls.

The OpenAI API adapter uses the Responses API with `store: false`; its API key is
write-only from the WebView and is read only by the native host. The local adapter
uses OpenAI-compatible Chat Completions and initially accepts loopback endpoints
only. Either adapter can be selected without changing agent operation grants.

Provider capabilities are explicit and independently gated. The ChatGPT/Codex
adapter may list installed skills and accept up to four explicit skill choices
for one turn. A skill contributes instructions but never grants operations,
storage, or provider tools. Image generation is a separate external-effect mode:
the native host admits only the image tool for that turn, validates its output,
and stores accepted media in the private `ai-chat` app namespace behind an opaque
resource ID. Web search and image generation cannot run in the same request.

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
client of that layer. `mybox-app/src/desktop/` bridges core storage and agent
providers to Tauri, while `mybox-app/src-tauri/` owns native dialogs, filesystem
commands, credential-owning provider clients, and process isolation. Future secret
and cloud adapters stay behind the same host boundary; app handlers must not call
Tauri APIs directly.
