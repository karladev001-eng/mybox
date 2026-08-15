# Native Source

- `main.rs`: thin executable entry point.
- `lib.rs`: Tauri builder, plugins, and command registration.
- `workspace.rs`: workspace selection plus app-scoped JSON persistence.
- `codex.rs`: constrained Codex App Server client for ChatGPT subscription status,
  sign-in, and inference.
- `agent_providers.rs`: OS-backed API secrets, non-secret provider settings, and
  constrained OpenAI API/local-LLM HTTP adapters.

Native commands are host capabilities. Validate every app ID and relative key,
reject symlinks and path traversal, and never accept an unrestricted path from an
app operation.

Provider processes receive no workspace path. Keep prompts on stdin/protocol
messages, reject provider tool use, and never read or return credential files.
Provider HTTP adapters must use fixed or validated endpoints, finite timeouts,
bounded responses, and native-only credential access.
