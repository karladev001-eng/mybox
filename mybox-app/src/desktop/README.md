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
- `profile-preferences.js`: binds host profile preferences to the same native
  app-scoped storage boundary, with an in-memory Web preview fallback.
- `app-installations.js`: binds the installed App catalog to device-local Host
  storage, with an in-memory Web preview fallback.
- `app-updater.js`: checks for, downloads, and installs a signed MyBox release
  before relaunching, resolving to a no-op outside the desktop runtime.
- `accounts.js`: runs the OAuth device flow and reports the signed-in profile,
  staying signed out in the Web preview. Access tokens never cross this bridge.
- `sync-endpoints.js`: connects a Project to the sync server its group runs,
  joins one by invite, issues invites, and lists or removes members. Unlike an
  account token, the member token does cross this bridge, because the sync
  socket carries it in its URL.
- `cloudflare.js`: stores the User's Cloudflare API token and drives deploying,
  redeploying, or deleting the group's sync server Worker. The token never
  crosses back over this bridge once stored, staying unsupported in the Web
  preview like the other native-only credential flows here.

Keep native command names aligned with `src-tauri/src/lib.rs`. Do not expose raw
filesystem access to app modules.
