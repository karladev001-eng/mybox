# MyBox App Framework

## Package contract

Each app is a trusted package registered with the host. Its manifest contains:

- stable app ID and semantic version;
- operation and event contracts expressed as JSON Schema;
- each operation's effect: `read`, `write`, `external`, or `destructive`;
- each operation's Confirmation class and optional grant-constraint contract;
- allowed callers: `user`, `agent`, `flow`, `app`, or `system`;
- required host capabilities such as app storage, file selection, network access,
  secrets, or notifications.

Operation and event IDs are globally namespaced with the app ID, such as
`notes.read` and `notes.created`. Contract changes are backward compatible within
a major version. Breaking changes use a new major contract or a new ID.

An app may be disabled or unregistered at runtime. The host then removes its
operations and event declarations. Consumers must treat `not found`, `disabled`,
`permission denied`, schema failure, timeout, and cancellation as normal outcomes.

The Host records the installed SemVer for each App separately from the version
offered by its trusted Registry. Only a higher Registry version is an update; the
Host does not silently downgrade an installed App. Remote discovery, package
signature verification, migrations, and rollback must finish through Host-owned
lifecycle adapters before a downloaded version is advertised as available. A
Host that retains only the offered executable Surface blocks launch while its
installed record has a different version; it must not run one version while
reporting another as active.

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

The user-selected Workspace directory is authoritative for Host metadata and
App-common state. The Host gives each App an App-scoped storage port whose keys
cannot escape that namespace. Apps must not open another App's directory or
depend on its on-disk representation.

An App may also declare User-selectable Project stores. A Project store is
authoritative for one Project and is exposed to its owning App through a
Project-scoped storage port, never an unrestricted raw path. Other Apps, Flows,
and Agents continue to use Operations even when they are authorized for that
Project. App-common storage does not retain Project content or search excerpts;
an unavailable Project store makes its data Operations unavailable until the Host
validates a User-selected replacement location.

Every Project store contains a small Host-managed manifest with its immutable
Project ID, owning App ID, storage schema version, creation and migration metadata,
and relative layout. The Host validates this manifest rather than inferring
identity from the filesystem path or directory name. The manifest contains no
credentials or other secrets.

A directory copy retains its manifest and therefore represents another location
of the same Project, not a new Project. The Host may reconnect an unavailable
Project to that location, but must reject attaching two available copies as
independent Projects. A separate Project is created only through an explicit
Duplicate Project operation, which assigns new Project, Page, and Block IDs and
rewrites internal PageLinks.

Duplication carries only active Pages, Blocks, Tags, PageLinks, and resources
referenced by that active state. It excludes Trash, Page history, sharing
membership and permissions, cloud synchronization configuration, and device
metadata. The result is a new unshared local Project and may retain the source
titles because title uniqueness is Project-scoped.

The target desktop layout is:

```text
<workspace>/
  .mybox/             host metadata, registry, grants, audit and flow definitions
  apps/<app-id>/      common private state owned by one app
  resources/          host-managed large resources and revisions

<project-directory>/ private state and resources owned by one Project
```

The JavaScript memory driver is for tests and the Web prototype. The current Tauri
driver implements App-scoped JSON reads and atomic replacement in the selected
Workspace; Project-store ports and App-private database support are extension
points. The native provider adapter stores API secrets in the OS credential store.
Google Cloud and other providers are opt-in adapters for import, export, backup,
or synchronization. They exchange versioned changes and do not become a direct
shared database or alternate access path into App internals.

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

The chat composer projects available tools and skills into a provider-neutral
slash-command palette; applying a command changes only the same explicit turn
state as its visible control. Model and reasoning choices are also provider
capabilities. Codex choices come from the native `model/list` result and are
revalidated before each turn. Subscription quota is displayed as the remaining
percentage reported by Codex, while metered API responses store and total their
exact token usage. These controls do not grant an operation or provider tool.

The Host evaluates allowed callers, Operation grants, data and input constraints,
and the User profile's Confirmation level independently. An Operation runs without
a per-invocation prompt only when its Confirmation class is covered by the profile
level and every narrower grant passes; `always-confirm` cannot be bypassed. Every
invocation records actor, Operation, effect, Confirmation class, matched policy,
timestamp, correlation ID, duration, and outcome, but not raw inputs or outputs.

For Project-scoped Operations, the Host also enforces the caller's Project role.
Owner, Editor, and Viewer determine whether an action is authorized; Confirmation
level never broadens that role. Each shared Project has exactly one Owner, Editors
may change its knowledge and use recoverable Trash operations, and Viewers are
limited to read and search Operations. Permanent Page deletion and Project
lifecycle Operations require Owner authority.

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

The reference Host currently enforces caller declarations, exact Operation-ID
grants, Confirmation classes and levels, fresh approval, schema validation, and
metadata-only audit. Declarative input constraints, Project-scoped Host handles,
grant management UI, and Change-proposal application are the next authorization
extensions rather than behavior supplied by individual App handlers.
