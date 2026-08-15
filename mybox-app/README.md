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

## AI providers

The desktop app discovers a locally installed Codex CLI and uses its official
ChatGPT sign-in through Codex App Server. Run `codex login` once, or use the
ChatGPT row in MyBox settings. The detected plan name is display-only; MyBox does
not restrict the adapter to Plus or any other tier.

This adapter refuses API-key authentication so subscription use cannot silently
become metered API use.

OpenAI API is a separate setting. Its key is stored in the operating system
credential store and is never returned to the WebView or written to the workspace.
Requests use the Responses API, opt out of response storage, and do not enable
provider-hosted tools.

Local LLM connects to an OpenAI-compatible Chat Completions server on loopback.
For example, configure `http://127.0.0.1:11434/v1` plus the exact local model name.
Remote endpoints, redirects, embedded credentials, and system proxies are rejected
by this initial adapter.
