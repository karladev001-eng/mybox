# Source

Contains the React interface and the host-independent app framework.

- `main.jsx`: browser entry point.
- `App.jsx`: current prototype screens and interactions.
- `ChatView.jsx`: session navigation, conversation transcript, and composer for
  the independent AI chat app, including Web-search consent, explicit skill
  selection, slash-command discovery, model/Thinking controls, provider-specific
  usage, generated-image display, and source links.
- `ThemedSelect.jsx`: reusable, keyboard-operable listbox used instead of native
  desktop dropdown rendering.
- `styles.css`: prototype visual system and responsive styles.
- `core/`: app contracts, operation/event routing, authorization hooks, audit, and
  app-scoped storage.
- `desktop/`: the runtime bridge for Tauri workspace and storage commands.

UI code may call the core API but must not access another app's state or a future
Tauri adapter directly.
