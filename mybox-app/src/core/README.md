# App Core

This directory is the runtime-neutral reference implementation of the MyBox app
contract described in `../../../docs/app-framework.md`.

- `app-contract.js`: manifest constants, validation, and app definition helper.
- `app-host.js`: registration, removal, operation routing, events, authorization,
  schema validation, and audit metadata.
- `app-runtime.js`: composes the installed first-party App definitions into one
  Host so unopened Apps remain callable by Connections, Flows, and Agents.
- `connections.js`: persists typed Connector pairings, creates Operation-only
  grants, and runs pull and Event-to-consume delivery with status and retry.
- `resource-broker.js`: validates opaque resource references and transfers bytes
  only through registered App providers/importers.
- `agent-provider.js`: provider descriptor validation and replaceable provider
  registry.
- `agent-runtime.js`: structured agent loop that invokes apps only through the
  host operation boundary, gating a write against the caller-supplied
  Confirmation level and pausing for approval before it runs
  ([ADR 0025](../../../docs/adr/0025-agent-operations-from-the-assistant-panel.md)).
- `agent-host-registry.js`: maps an App ID to the live `AppHost` its own
  `client.js` already constructed, so the assistant panel can invoke that
  App's Operations without holding a private reference to every App.
  `createAggregateAgentHost()` unions every registered host's Operations and
  routes a call by its ID's App-prefix, so all of them are available from any
  screen rather than only while that App's own View is open.
- `chat-history.js`: provider-neutral AI chat sessions, bounded context building,
  and the app-scoped persistence contract.
- `profile-preferences.js`: validated device-local profile preferences, including
  the confirmation level retained across app restarts.
- `app-version.js`: SemVer validation, precedence comparison, and update checks.
- `app-installations.js`: validated installed App IDs, installed versions, and
  serializable custom App metadata retained through the Host storage port.
- `account-identity.js`: Profile ID construction from a Linked account, and
  resolution of a host account view into the session Operations run as.
- `keyboard-shortcuts.js`: Host shortcut metadata, palette-only installed-App
  and home commands, and layout-tolerant runtime-neutral key-event resolution.
- `host-session.js`: versioned last-surface state for restoring a valid Host
  destination and optional installed App at startup.
- `storage.js`: app-scoped JSON and bounded UTF-8 text storage ports plus the
  in-memory test/Web driver.

Production filesystem, secrets, network, and cloud adapters belong behind these
ports. `app-runtime.js` is the composition root and may register trusted built-in
App definitions and their narrow desktop ports; the other core modules do not
import React, Tauri, provider SDKs, or app-specific modules.
