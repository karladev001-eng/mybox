<img src="docs/assets/mybox-wordmark.png" alt="MyBox" width="220">

MyBox is a local knowledge workspace for writing, linking, searching, and reusing
notes, AI conversations, and recorded model context. Knowledge is the mandatory
record foundation; optional tools use its authorized Operations. Structured Blocks
remain canonical, and Markdown is an interchange and AI-readable representation.

## Start here

- `CONTEXT.md`: shared product vocabulary and boundaries.
- `FRONTEND.md`: mandatory visual, interaction, control, and UI review rules.
- `docs/README.md`: architecture documentation and ADR index.
- `mybox-app/README.md`: current React prototype and framework package.
- `sync-server/README.md`: the sync server a group deploys for its own shared
  Projects. MyBox operates none; MyBox drives the deploy through the
  Cloudflare API rather than hosting it ([ADR 0024](docs/adr/0024-deploy-the-sync-server-through-the-cloudflare-api.md)).
- `AGENTS.md`: mandatory repository workflow.

The `.agents/` directory is tool-managed reference material and is not part of the
product source.

Search, tags and PageLinks organize the workspace. Both navigation columns start hidden; search, Project selection, Page creation and File import remain available in the header. File originals are immutable records with automatic image/PDF display.

The home screen now opens recent records and Projects directly. Workflow UI and
automatic execution are retired; existing definitions/history remain stored (ADR 0049).

Settings offers Graphite, Light, Sepia and Midnight themes across the workspace (ADR 0050).

User Prompt templates and Image generation history are Knowledge Pages; originals
are verified Project Files with source links (ADR 0051).
