<img src="docs/assets/mybox-wordmark.png" alt="MyBox" width="220">

MyBox is a local-first desktop toolbox for independently usable, removable apps.
Apps can be composed through public operations and events, and the same contracts
are available to flows and authorized AI agents.

## Start here

- `CONTEXT.md`: shared product vocabulary and boundaries.
- `FRONTEND.md`: mandatory visual, interaction, control, and UI review rules.
- `docs/README.md`: architecture documentation and ADR index.
- `mybox-app/README.md`: current React prototype and framework package.
- [mybox-sync-server](https://github.com/karladev001-eng/mybox-sync-server): the
  sync server a group deploys for its own shared Projects. MyBox operates none.
  A separate repository because the Cloudflare deploy button this project relies
  on does not reliably deploy from a subdirectory of a monorepo.
- `AGENTS.md`: mandatory repository workflow.

The `.agents/` directory is tool-managed reference material and is not part of the
product source.
