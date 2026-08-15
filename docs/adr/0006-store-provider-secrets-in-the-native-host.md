# ADR 0006: Keep provider secrets in native credential storage

- Status: Accepted
- Date: 2026-08-15

## Context

MyBox now supports provider configurations that use a metered API key or a local
OpenAI-compatible endpoint. API credentials must not become app state, workspace
data, browser storage, logs, or values that can be read back by the WebView. A
configurable endpoint also creates an unintended network-access path unless its
initial scope is explicit.

## Decision

The native host owns provider configuration and inference network calls. OpenAI
API keys are stored under a fixed MyBox service and account name in the operating
system credential store. The WebView may submit a replacement key once, but the
native API never returns it. Non-secret settings such as the selected provider,
model name, and local base URL are stored atomically in the Tauri application
configuration directory, separately from app-owned workspace state.

The OpenAI adapter sends stateless requests to the fixed Responses API endpoint,
uses bearer authentication only in the native HTTP client, disables response
storage with `store: false`, and exposes no provider-hosted tools. Structured
results use `text.format` with a JSON Schema when the caller supplies one. The
provider performs best-effort shaping because operation inputs are app-defined;
the host remains authoritative for decision and operation-payload validation.

The initial local adapter targets OpenAI-compatible Chat Completions servers. It
accepts only plain HTTP loopback URLs (`localhost`, `127.0.0.1`, or `::1`), disables
redirects and system proxies, and revalidates the saved URL before every request.
Remote custom endpoints and their credentials require a later decision.

Both adapters keep finite connection and request timeouts, cap prompt and response
sizes, and return sanitized errors. Provider output remains untrusted data and can
affect apps only through the operation authorization and audit boundary from ADR
0003 and ADR 0005.

## Consequences

- API billing is always an explicit, separately configured provider path.
- Removing an API configuration deletes its OS credential and leaves no secret in
  the workspace or provider settings file.
- Local models work without an API credential, while the loopback restriction
  prevents the setting from becoming a general server-side request primitive.
- Users running a local server on another machine cannot connect in the initial
  implementation; a future remote-provider adapter can add that deliberately.

## Implementation notes

- `mybox-app/src-tauri/src/agent_providers.rs` owns credential storage, settings,
  URL validation, native HTTP calls, and response parsing.
- `mybox-app/src/desktop/agent-providers.js` exposes the three native adapters
  behind the shared provider contract.
- Provider settings contain configuration and connection booleans only. They
  never serialize credential values.
