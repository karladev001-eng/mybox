# Desktop Bridge

This directory contains the narrow JavaScript bridge between the runtime-neutral
app core and Tauri. It is safe to import from the Web build, but native functions
must only be called when `isDesktopRuntime()` returns true.

- `workspace.js`: workspace selection and persisted workspace lookup.
- `tauri-storage.js`: app-scoped storage driver backed by Rust commands.
- `agent-providers.js`: ChatGPT subscription, OpenAI API, and local-LLM adapters
  whose credentials, processes, and network calls stay in the native host.
- `chat-history.js`: binds the independent AI chat app to native app-scoped
  workspace storage, with an in-memory Web preview fallback.

Keep native command names aligned with `src-tauri/src/lib.rs`. Do not expose raw
filesystem access to app modules.
