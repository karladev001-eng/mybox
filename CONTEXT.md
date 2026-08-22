# MyBox Context

## Product

**MyBox** is a local-first desktop toolbox containing independently useful apps.
An app can be installed, enabled, disabled, or removed without requiring another
app to function.

## Domain language

**App** — A trusted, self-built package with a manifest, private state, UI, and
optional public operations and events.

**Host** — The MyBox runtime that registers apps, routes operations and events,
authorizes callers, supplies storage, and records audit metadata.

**Operation** — A versioned request/response capability owned by one app. It has a
JSON Schema contract, an effect classification, a Confirmation class, and an
explicit set of callers.

**Event** — An immutable notification that something already happened in an app.
Events may trigger follow-up work but do not expose the app's private state.

**Workflow** — A Host-owned, saved automation that starts from an Event, User
action, schedule, or App request and passes typed Operation output to ordered
later Steps. Workflows use no privileged integration path. The serialized caller
type remains `flow` for App contract compatibility.
_Avoid_: direct App integration, script

**Workflow Command** — A visual pass-through Step projected by the Host from a
non-destructive Operation exposed to both Agent and Flow callers. Its saved
configuration and optional Workflow JSON mappings form the Operation input, it
keeps any typed item from the preceding Step unchanged, and its validated result
is recorded in the Workflow JSON document. Normal grants, Confirmation, audit,
and Project role checks still apply.
_Avoid_: script step, privileged command

**Workflow JSON document** — The single Host-owned, versioned JSON working file
for one Workflow. User values live below `$.data`; Trigger and actual Step inputs,
outputs, states, and errors are retained under reserved Run records. It contains
Resource references, never resource bytes.
_Avoid_: App storage, audit log, binary payload file

**Workflow JSON mapping** — A restricted JSON-path binding that reads a Workflow
document value into an Operation input or writes an Operation result value below
`$.data`. It supports properties, numeric indexes, and read-only array wildcards,
but no expressions or wildcard destinations.
_Avoid_: script, expression, unrestricted JSONPath

**Connector** — An App-declared, versioned source or target for one typed data
shape. A Connector names the pull Operation, push Event, pull library, or consume
Operation a Workflow may use; it is not itself a grant.
_Avoid_: direct App integration, storage adapter

**Connection** — The legacy saved pairing of one source and one target Connector.
Connections migrate to Workflows; the term remains only for the compatibility
storage and API bridge during migration.
_Avoid_: current automation, unrestricted App permission

**Agent** — An AI-controlled caller that can discover and invoke only operations
exposed to it. Reads and writes remain subject to host authorization and auditing.

**User profile** — A MyBox identity representing one User and owning that User's
persistent Host preferences. It is distinct from operating-system and Agent
provider accounts. A profile with no Linked account still works and is
identified locally.
_Avoid_: provider account

**Linked account** — An external provider identity, currently GitHub, bound to a
User profile so that identity is meaningful to other devices and Users. MyBox
authenticates through the provider and never holds a password. Linking is
optional and required only to reach a shared Project.
_Avoid_: login, credential, sign-up

**Sync endpoint** — The address of the sync server a shared Project merges
through, chosen by the Project's Owner and operated by their group rather than by
MyBox. A Project without one never leaves the device.
_Avoid_: cloud, backend, our server

**Invite token** — A single value an Owner issues and passes to a person joining
a shared Project. The server exchanges it once for a recorded membership, so
access is revoked per member instead of by changing a shared secret.
_Avoid_: password, shared key, room key

**Cloudflare API token** — A credential the User pastes into MyBox, scoped to
Workers Scripts and Durable Objects edit permissions, that lets MyBox deploy
and manage their group's sync endpoint directly instead of through a
GitHub-connected dashboard flow. Distinct from an Invite token: it can create
or delete the sync endpoint itself, not just join one Project on it, and it
never leaves the native host once stored.
_Avoid_: secret key, deploy key

**Profile ID** — The stable value a Project membership stores to identify a User.
It is `local-user` on a profile with no Linked account, and
`<provider>:<subject>` once linked, built from the provider's immutable subject
so renaming an upstream account preserves membership.
_Avoid_: user name, login name, email

**Change proposal** — An Agent-authored set of Page or Block changes that has no
effect until a User reviews and applies it.
_Avoid_: Agent edit, automatic edit

**Confirmation level** — A User-profile setting that determines which
already-authorized Operations an Agent may run without per-invocation User
confirmation. The cumulative levels are Review, Recoverable, and Autonomous; none
grants an Operation or expands an App's data scope.
_Avoid_: Full access mode, Direct-write mode, permission scope

**Confirmation class** — An App-declared minimum Confirmation level for running
an Operation unattended, or a requirement that the Operation always be confirmed.
_Avoid_: Effect, permission scope

**Recoverable Operation** — A non-external write Operation that the owning App
guarantees can be reversed through a Host-authorized Undo Operation during a
declared recovery period.
_Avoid_: Safe Operation, harmless write

**Operation grant** — A revocable authorization for a caller to invoke one or more
Operations under App-declared, Host-enforced data and input constraints.
_Avoid_: Confirmation level, unrestricted access

**Search scope** — The Projects and Page states included in one search. It
defaults to active Pages in the current Project; Trash or additional authorized
Projects must be selected explicitly.

**Agent provider** — A replaceable inference adapter used by an agent. Providers
declare their authentication kind and capabilities but never receive direct app
storage access. ChatGPT subscriptions, metered APIs, and local models are separate
provider configurations.

**Agent provider identity** — Display-only identity metadata returned by an
official Agent provider client, such as the email for the ChatGPT subscription
currently used through Codex. It identifies which inference account is active but
is neither a MyBox Linked account nor a credential, and is not persisted by MyBox.
_Avoid_: Linked account, API key, access token

**Chat session** — A provider-neutral, locally stored conversation owned by the
`ai-chat` app. It contains ordered user and assistant messages and may continue
through a different provider without exposing another app's state.

**Assistant panel** — A Host-owned, collapsible view of the `ai-chat` App that
stays beside another active Surface. A Surface may provide a display-only context
label, but the panel gains no App storage access, Operation grant, or additional
provider capability from that label.
_Avoid_: Embedded App agent, direct App access

**Web search capability** — A user-visible, read-only provider capability for
retrieving current public information. It returns validated source metadata but
does not grant commands, file access, MCP access, or another app's operations.

**Skill** — A reusable workflow discovered through a provider's supported skill
protocol. A user may select it for one agent turn, but the skill does not grant
operations, tools, storage, or network access beyond the capabilities separately
authorized for that turn.

**Generated media** — A provider-created image or future media artifact copied
into the owning app's private workspace storage. Conversation state stores an
opaque resource reference rather than provider bytes or a filesystem path.

**App Registry** — The Host-owned catalog of validated, installable App Surface
definitions. Registry membership controls launcher discovery and Surface loading
but grants no Operations, storage, provider capabilities, or data access.
_Avoid_: App manifest, permission grant, plugin marketplace

**App Surface** — The User-visible interface entry point resolved for an installed
App by the App Registry. A Surface is loaded independently from the App's runtime
Operation manifest and must use Host boundaries for authority and storage.
_Avoid_: Operation handler, unrestricted plugin code

**Installed App version** — The SemVer release of one App recorded as active on
the current device. It is distinct from both the MyBox Host version and the newer
App version that may be advertised by the App Registry.
_Avoid_: Host version, storage schema version

**App update** — A Host-mediated transition from an installed App version to a
newer trusted Registry version. A direct User action may apply a locally available
update; Agent and Flow callers still require a declared, authorized, audited
Operation.
_Avoid_: Registry refresh, silent downgrade

**Slash command** — A composer shortcut that discovers and toggles an existing
tool or skill selection. It changes explicit per-turn intent but grants no new
provider, operation, storage, or network authority.

**Keyboard shortcut** — A Host-resolved key combination that invokes an existing
visible navigation or action control while the MyBox window is focused. Host
shortcuts are reserved globally; App shortcuts are declared in the Registry and
active only while that App Surface is selected. Neither grants authority nor
registers an operating-system-wide hotkey.

**Shortcut menu** — The Host command palette that lists keyboard shortcuts,
installed-App launch commands, and MyBox home navigation, and lets a User
search or execute them with Tab and Enter. Each App's launch command and active
Surface commands share one `<name> App` group. It is a discovery surface, not a
separate privileged command path.

**Reasoning effort** — A provider-advertised level controlling how much model work
is requested for a turn. Available values belong to the selected model and must
not be assumed across providers.

**Usage snapshot** — Provider usage metadata kept in its native meaning: a live
remaining quota percentage for subscriptions or actual token counts for metered
API responses.

**Design token** — A semantic name for a reusable surface, text, boundary, intent,
shape, spacing, motion, or elevation value. Components consume the role rather
than inventing visually similar one-off values.

**Workspace** — The user-selected local directory that is authoritative for MyBox
metadata and each App's common local state. A Project may keep its authoritative
data in a separately selected Project store.

**Project** — An exclusive organization and sharing boundary for Pages within the
knowledge App. Every Page belongs to exactly one Project, with Personal as the
default Project.
_Avoid_: Workspace, folder, parent Page

**Project role** — A Project-scoped membership role that determines what a User
may do in that Project. Owner controls membership and Project lifecycle, Editor
may make recoverable knowledge changes, and Viewer may only read and search it;
irreversible Page deletion is reserved for Owner.
_Avoid_: Confirmation level, App permission, global role

**Project store** — A User-selected local directory that is authoritative for one
Project's private data. Cloud sharing uses a synchronization adapter rather than
sharing the store's database file.
_Avoid_: Workspace, Vault, shared database

**Project store manifest** — A Host-managed identity and compatibility record
inside a Project store. It identifies the Project, owning App, and storage schema
without containing credentials or other secrets.
_Avoid_: Project settings, path identity

**Unavailable Project** — A Project whose catalog entry remains known but whose
Project store cannot currently be located and validated. Its content cannot be
read, searched, or changed until the store is reconnected.
_Avoid_: Deleted Project, empty Project

**Tag** — A flat, Project-owned classification label that may be applied to any
number of Pages in that Project. Tags do not determine Page ownership or access
and do not form a parent-child hierarchy.
_Avoid_: Project, folder

**Author color** — A Project-scoped basic color assigned to an account and used
with its display name to identify the last editor of shared Blocks and history
entries. The immutable profile ID remains the internal attribution key. It is
descriptive metadata, not a role or access control.
_Avoid_: presence color, permission color, text color

**Presence** — Ephemeral shared-Project state identifying accounts that are
connected now. Note presents it as labelled profile icons; it disappears on
disconnect and is neither membership nor Page history.
_Avoid_: member directory, last editor, persisted activity

**Last working surface** — The most recent stable Host destination or open App
restored at startup. It excludes App-private navigation, transient overlays,
input drafts, and pending actions.
_Avoid_: full session snapshot, selected Page, reopened modal

**Storage adapter** — A host implementation for local persistence or optional
cloud synchronization. Apps use the storage port rather than provider SDKs or raw
paths for private state.

**Resource reference** — A stable identifier plus media type and revision for
passing large files between apps without copying their bytes into operation
payloads.

**Prompt template** — A named, axis-specific Markdown fragment that Image
combines into a final image-generation Prompt. A local Prompt template is owned
by Image; a connected Note Page remains owned by Note and is read at its current
revision.
_Avoid_: complete generated Prompt, synced file

**Final Prompt** — The complete text Image submits for one generation. It may be
compiled from the current subject and Prompt templates or explicitly replaced by
an edited or imported draft. A Final Prompt is copied into generation history;
its source file or Note Page remains independently owned.
_Avoid_: Prompt template, live file link

**Page** — An independently addressable unit of authored knowledge with a title
that is unique across active and trashed Pages in its Project. Its
identity persists when its title or content changes. Titles that differ only by
surrounding whitespace, letter case, or character width are the same title.
_Avoid_: Note file, document

**Block** — An independently addressable, typed, ordered unit of content within a
Page. A Page's visible body is the composition of its Blocks.
_Avoid_: Line, paragraph

**Page history** — The time-ordered record of User and Agent changes to a Page
that can be restored during its recovery period. Restoring history creates a new
revision rather than erasing later records.
_Avoid_: Undo stack, backup

**Knowledge graph** — The active Pages and Page links within one Project, owned by
one App as authoritative workspace data.
_Avoid_: Vault

**Page link** — A directed relationship from a Block to an active Page. It
retains the target Page's identity even when that Page is renamed.
_Avoid_: File link, unresolved link

**Trash** — The reversible state of Pages removed from active use. Trashed Pages
retain their identity and Blocks but not their incoming Page links, and are
excluded from discovery unless the Search scope explicitly includes Trash.
_Avoid_: Deleted Pages

## Fixed boundaries

- App state is private to its owner.
- Cross-app work uses operations and events only.
- Removing an app removes its callable capabilities; retained user data follows a
  separate explicit deletion policy.
- Local Workspace and Project-store data remain authoritative; cloud sharing is a
  synchronized adapter path rather than direct access to App internals.
