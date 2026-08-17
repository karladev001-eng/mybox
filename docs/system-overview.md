# MyBox system overview

![MyBox system overview](assets/mybox-system-overview.png)

The generated overview distinguishes current paths with solid mint lines and
planned paths with dashed violet lines. The exact architecture is defined below;
this Mermaid diagram is authoritative when a raster label or connector is
ambiguous.

```mermaid
flowchart LR
  User["User"]
  Agent["AI Agent"]
  Flow["Saved Flow"]

  subgraph Host["MyBox Desktop Host"]
    Shell["React Shell"]
    Registry["App Registry<br/>validate · install · resolve Surface"]
    Router["Operation + Event Router"]
    Auth["Authorization + Audit"]
    StoragePort["Host Storage Ports"]
    ProviderPort["Agent Provider Port"]
    Shell --> Registry
    Router --> Auth
  end

  subgraph Apps["Independent Apps"]
    Knowledge["Knowledge App<br/>Pages · Blocks · Links · Search"]
    Chat["AI Chat App<br/>Sessions · Provider-neutral history"]
    Future["Future App package"]
  end

  subgraph Local["Authoritative local data"]
    Common["apps/<app-id>/"]
    ProjectStore["Project Stores<br/>(planned scoped SQLite/FTS)"]
  end

  subgraph Adapters["Constrained adapters"]
    Providers["AI Providers<br/>ChatGPT · OpenAI API · Local LLM"]
    Obsidian["Obsidian Exchange<br/>(planned)"]
    Cloud["Cloud Sync / Sharing<br/>(planned)"]
  end

  User --> Shell
  Agent --> Router
  Flow --> Router
  Registry --> Knowledge
  Registry --> Chat
  Registry -.-> Future
  Knowledge --> Router
  Chat --> Router
  Future -.-> Router
  Auth --> Knowledge
  Auth --> Chat
  Auth -.-> Future
  Knowledge --> StoragePort
  Chat --> StoragePort
  StoragePort --> Common
  StoragePort -.-> ProjectStore
  Chat --> ProviderPort --> Providers
  Knowledge -.-> Obsidian
  ProjectStore -.-> Cloud
```

## Current implementation boundary

- The App Registry validates stable IDs and Surface contracts and resolves the
  Knowledge Surface lazily. Registered Apps can be removed and added again from
  the launcher without introducing another App-specific render branch. Installed
  IDs and custom generic metadata persist in the current device's Host namespace.
- Apps still declare Operations and events separately. Registry membership does
  not grant storage, caller, provider, or Project access.
- App-common local state currently uses `apps/<app-id>/`. The Knowledge vertical
  slice still uses App-scoped JSON while Project stores, SQLite/FTS, Obsidian
  exchange, cloud synchronization, and realtime collaboration remain planned.
