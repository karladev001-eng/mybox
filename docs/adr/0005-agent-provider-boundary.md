# ADR 0005: Isolate agent providers behind a capability contract

- Status: Accepted
- Date: 2026-08-15

## Context

MyBox needs an embedded agent that can initially use a user's ChatGPT
subscription, while leaving room for metered APIs, other officially supported
subscriptions, and local LLMs. ChatGPT subscription access and OpenAI API billing
are different authentication paths. Provider credentials must not leak into app
state or the WebView, and changing a model provider must not create a privileged
route around app operations.

## Decision

The host exposes a provider-neutral agent contract. A provider declares a stable
ID, its kind (`subscription`, `api`, or `local`), authentication mode, and
capabilities, and implements status and generation methods.

The first adapter is `openai-codex-subscription`. The native host launches the
locally installed Codex App Server over stdio and accepts generation whenever
Codex reports managed ChatGPT authentication. It does not whitelist or hardcode a
plan name: the current `planType` is display metadata, so supported ChatGPT Free,
Go, Plus, Pro, Business, Enterprise, Edu, and future plans can use the same path
according to their Codex entitlement. Codex owns its browser sign-in, token
refresh, and credential storage; MyBox never reads ChatGPT cookies, account
passwords, access tokens, or Codex's credential files. API-key authentication is
rejected by this adapter so a request cannot silently incur API charges.

Each inference turn uses an ephemeral thread, an isolated temporary working
directory, read-only/no-network sandbox settings, and no approvals. The adapter
fails the turn if Codex attempts a command, file change, MCP call, or other tool.
Web search is prohibited by default and may be admitted only through the narrow,
user-visible provider capability defined by ADR 0008. Model output is data for
MyBox's agent runtime, not authority to touch the machine.

The agent runtime discovers only operations exposed to the `agent` caller and
invokes them through `AppHost`. Existing grants, effect checks, approval rules,
schema validation, and audit records therefore apply equally to every provider.

Future API providers will keep secrets in a native OS-backed secret adapter and
perform network calls outside the WebView. Future local providers will use the
same contract and explicitly declare local execution. Other subscription adapters
are allowed only when the provider offers an official client authentication or
embedding path; browser cookies and unofficial token extraction are prohibited.

## Consequences

- ChatGPT subscription plans can use the officially supported Codex authentication
  path without pretending that a plan is an OpenAI API credit balance.
- Users must install Codex locally and complete its ChatGPT sign-in before the
  initial provider is available.
- Provider output cannot bypass app operation authorization, regardless of model
  vendor or where inference runs.
- The current adapter is intentionally non-streaming and one-turn-per-process.
  A supervised long-lived App Server connection can replace it behind the same
  contract when conversation streaming is required.

## Implementation notes

- `mybox-app/src/core/agent-provider.js` defines provider descriptors and the
  registry.
- `mybox-app/src/core/agent-runtime.js` translates structured model decisions into
  authorized `AppHost` calls.
- `mybox-app/src/desktop/agent-providers.js` is the Web-safe native bridge.
- `mybox-app/src-tauri/src/codex.rs` owns Codex discovery, sign-in, account status,
  and the constrained App Server protocol client.
- On Windows, Codex discovery preserves `PATH` directory precedence across native
  executables and command shims. This prevents a later IDE-bundled binary from
  shadowing an earlier authenticated CLI installation.
- Windows command shims are launched without creating a visible console window,
  while retaining the attached stdio stream required for the complete App Server
  JSON-RPC handshake. The same no-console flag applies to direct Codex processes
  so status checks, sign-in, and chat do not flash a terminal.
- ADR 0006 implements the separate OpenAI API and local-LLM adapters without
  changing this provider contract.
- ADR 0008 amends the blanket tool prohibition only for explicitly enabled,
  hosted Web search; all mutation-capable tools remain blocked.
- ADR 0009 adds explicitly selected skills and a turn-scoped image-generation
  tool without granting skills independent tool or storage authority.
- ADR 0010 adds provider model/Thinking discovery and provider-specific usage
  reporting without conflating subscription quota with metered API tokens.
