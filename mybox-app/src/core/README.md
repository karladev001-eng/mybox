# App Core

This directory is the runtime-neutral reference implementation of the MyBox app
contract described in `../../../docs/app-framework.md`.

- `app-contract.js`: manifest constants, validation, and app definition helper.
- `app-host.js`: registration, removal, operation routing, events, authorization,
  schema validation, and audit metadata.
- `agent-provider.js`: provider descriptor validation and replaceable provider
  registry.
- `agent-runtime.js`: structured agent loop that invokes apps only through the
  host operation boundary.
- `chat-history.js`: provider-neutral AI chat sessions, bounded context building,
  and the app-scoped persistence contract.
- `profile-preferences.js`: validated device-local profile preferences, including
  the confirmation level retained across app restarts.
- `app-version.js`: SemVer validation, precedence comparison, and update checks.
- `app-installations.js`: validated installed App IDs, installed versions, and
  serializable custom App metadata retained through the Host storage port.
- `storage.js`: app-scoped storage port and in-memory test/Web driver.

Production filesystem, secrets, network, and cloud adapters belong behind these
ports. Do not import React, Tauri, provider SDKs, or app-specific modules here.
