# Source

Contains the React interface and the host-independent app framework.

- `main.jsx`: browser entry point.
- `App.jsx`: current prototype screens and interactions.
- `WorkflowView.jsx`: searchable horizontal Workflow editor for typed Actions
  and Agent Commands, with Schema-driven settings and Step-level durable history.
- `ChatView.jsx`: session navigation, conversation transcript, and composer for
  the independent AI chat app, including Web-search consent, explicit skill
  selection, slash-command discovery, model/Thinking controls, provider-specific
  usage, generated-image display, source links, and the compact Host assistant
  panel variant.
- `ThemedSelect.jsx`: reusable, keyboard-operable listbox used instead of native
  desktop dropdown rendering.
- `styles.css`: prototype visual system and responsive styles.
- `core/`: app contracts, operation/event routing, Workflow execution,
  authorization hooks, audit, and app-scoped storage.
- `desktop/`: the runtime bridge for Tauri workspace and storage commands.
- `apps/`: the validated Host catalog for installable launcher metadata and lazy
  App Surface resolution, including the version currently offered by the Host.
- `knowledge/`: the MyBox-owned Page/Block graph domain, public Operations,
  persistence client, and Notion-style editor surface.

UI code may call the core API but must not access another app's state or a future
Tauri adapter directly.
