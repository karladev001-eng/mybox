# App Core

This directory is the runtime-neutral reference implementation of the MyBox app
contract described in `../../../docs/app-framework.md`.

- `app-contract.js`: manifest constants, validation, and app definition helper.
- `app-host.js`: registration, removal, operation routing, events, authorization,
  schema validation, and audit metadata.
- `storage.js`: app-scoped storage port and in-memory test/Web driver.

Production filesystem, secrets, network, and cloud adapters belong behind these
ports. Do not import React, Tauri, provider SDKs, or app-specific modules here.
