# MyBox App

This package contains the current React/Vite prototype and the host-independent app
framework. The Web build stays usable while the desktop Tauri adapter is developed.

## Directory map

- `src/`: React UI and framework source.
- `src-tauri/`: desktop host, native permissions, and local workspace persistence.
- `tests/`: Node integration tests.
- `public/`: static files copied into the client build.
- `worker/`: Sites static-hosting fallback worker.
- `scripts/`: packaging helpers.
- `.openai/`: Sites hosting configuration.

For UI work, normally read `src/README.md`, `src/App.jsx`, and the relevant styles.
For app framework work, read `src/core/README.md`, `../docs/app-framework.md`,
and the ADR being implemented. Avoid build artifacts and screenshots unless visual
comparison is explicitly required.

## Commands

```sh
npm run test
npm run build
npm run test:sites
npm run dev:desktop
npm run build:desktop
```
