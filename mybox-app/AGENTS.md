# Prototype Instructions

Read and follow `../AGENTS.md`, `../CONTEXT.md`, this directory's `README.md`, and
the relevant ADR before changing files here. Use the README map to inspect only
the files required for the current task.

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Durable product direction

- MyBox is primarily a collection of independent, removable self-built apps.
- App-to-app flows are an optional secondary feature, never the home-screen hero.
- Keep the UI simple and stylish, with generous spacing, many consistent vector icons, and minimal Japanese copy.
- The selected visual direction is a dark charcoal command deck with colorful app icons, a compact AI shortcut, and secondary bottom navigation.
- The target runtime is a Tauri desktop shell with a user-selected local workspace as the source of truth.
- Apps own private state and collaborate through host-mediated operations and events only.
- Flows and AI agents use the same public app operations and remain subject to authorization and audit.
