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
- `host-session.js`: binds the Host's last stable destination to app-scoped
  storage, with an in-memory Web preview fallback.
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
- `open-url.js`: opens a link in the User's own browser through Tauri's opener
  plugin, since the WebView ignores `target="_blank"`. Falls back to
  `window.open` in the Web preview rather than staying unsupported, because it
  has no credential or native-only concern to gate on.
- `knowledge-images.js`: opens a native file picker limited to images, and
  stores a chosen, dropped, or pasted image (as raw bytes) under the
  Knowledge App's own private resource namespace — mirroring how the AI
  chat's generated images are stored (`src-tauri/src/knowledge_resources.rs`,
  `codex.rs`). The frontend only ever sees an opaque resource ID, never a
  filesystem path. Dropped and pasted images go through standard HTML5
  `dataTransfer`/`ClipboardEvent` handling in `knowledge/KnowledgeView.jsx`
  rather than Tauri's native drag-drop event, because the window disables
  `dragDropEnabled` (`src-tauri/tauri.conf.json`) so ordinary HTML5
  `draggable` Block reordering keeps working.
- `image-studio.js`: stores validated reference images, calls the authenticated
  Codex image bridge with up to four opaque references, and reads generated
  Image resources without exposing filesystem paths.

Keep native command names aligned with `src-tauri/src/lib.rs`. Do not expose raw
filesystem access to app modules.
