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
