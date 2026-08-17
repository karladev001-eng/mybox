# Native Source

- `main.rs`: thin executable entry point.
- `lib.rs`: Tauri builder, plugins, and command registration.
- `workspace.rs`: workspace selection plus app-scoped JSON persistence.
- `codex.rs`: constrained Codex App Server client for ChatGPT subscription status,
  sign-in, model/Thinking discovery, quota windows, inference, explicitly selected
  skills, hosted Web search, and generated-image ingestion.
- `agent_providers.rs`: OS-backed API secrets, non-secret provider settings, and
  constrained OpenAI API/local-LLM HTTP adapters, including API token accounting.
- `accounts.rs`: OAuth device-flow sign-in for the Linked account, with the access
  token in OS credential storage and only non-secret profile fields persisted.
- `sync_endpoints.rs`: claims or joins a Project on its group's sync server and
  keeps the member token in OS credential storage. The endpoint must be https
  unless it is loopback, so a token never crosses the network in the clear.

Native commands are host capabilities. Validate every app ID and relative key,
reject symlinks and path traversal, and never accept an unrestricted path from an
app operation.

Provider processes receive no workspace path. Keep prompts on stdin/protocol
messages, reject provider tool use, and never read or return credential files.
Provider HTTP adapters must use fixed or validated endpoints, finite timeouts,
bounded responses, and native-only credential access.

Web search is a separate read-only provider capability. Accept validated HTTP(S)
source metadata only, and never relax command, file, MCP, or workspace boundaries
when it is enabled.

Resolve skill IDs to native paths inside this module and never accept a skill path
from the WebView. Skills add instructions only; they do not relax tool policy.
Resolve Codex model IDs and reasoning efforts against the live native catalog;
never trust a WebView-supplied pair without revalidation.
For image-generation turns, admit only the image tool, validate bounded PNG/JPEG/
WebP output, persist it under the private `ai-chat` namespace, and return only an
opaque resource ID.
