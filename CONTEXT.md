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
JSON Schema contract, an effect classification, and an explicit set of callers.

**Event** — An immutable notification that something already happened in an app.
Events may trigger follow-up work but do not expose the app's private state.

**Flow** — A saved orchestration that passes operation outputs to later operations.
Flows are optional and use no privileged integration path.

**Agent** — An AI-controlled caller that can discover and invoke only operations
exposed to it. Reads and writes remain subject to host authorization and auditing.

**Agent provider** — A replaceable inference adapter used by an agent. Providers
declare their authentication kind and capabilities but never receive direct app
storage access. ChatGPT subscriptions, metered APIs, and local models are separate
provider configurations.

**Chat session** — A provider-neutral, locally stored conversation owned by the
`ai-chat` app. It contains ordered user and assistant messages and may continue
through a different provider without exposing another app's state.

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

**Slash command** — A composer shortcut that discovers and toggles an existing
tool or skill selection. It changes explicit per-turn intent but grants no new
provider, operation, storage, or network authority.

**Reasoning effort** — A provider-advertised level controlling how much model work
is requested for a turn. Available values belong to the selected model and must
not be assumed across providers.

**Usage snapshot** — Provider usage metadata kept in its native meaning: a live
remaining quota percentage for subscriptions or actual token counts for metered
API responses.

**Workspace** — The user-selected local directory that is the authoritative store
for app data and MyBox metadata.

**Storage adapter** — A host implementation for local persistence or optional
cloud synchronization. Apps use the storage port rather than provider SDKs or raw
paths for private state.

**Resource reference** — A stable identifier plus media type and revision for
passing large files between apps without copying their bytes into operation
payloads.

## Fixed boundaries

- App state is private to its owner.
- Cross-app work uses operations and events only.
- Removing an app removes its callable capabilities; retained user data follows a
  separate explicit deletion policy.
- Local data remains authoritative until a future sharing ADR changes that model.
