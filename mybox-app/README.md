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

For UI work, first read `../FRONTEND.md`, then `src/README.md`, `src/App.jsx`, and
only the relevant component and style files.
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

## Accounts

Signing in is optional. Without a Linked account MyBox stays fully local under
the `local-user` Profile ID; signing in is what makes an identity meaningful to
other devices, and is required only to reach a shared Project. MyBox never
receives a password ([ADR 0022](../docs/adr/0022-account-identity-through-oauth.md)).

Sign-in uses the GitHub device flow, which needs a `client_id` and no secret. To
enable it in your own build:

1. Create an OAuth App at <https://github.com/settings/developers>. Any
   homepage URL works; the device flow uses no callback URL.
2. On that app's page, enable **Device flow**.
3. Build with the client ID in the environment:

```sh
MYBOX_GITHUB_CLIENT_ID=<your client id> npm run build:desktop
```

The client ID is not a secret and may be committed or set in CI. A build without
it keeps every other feature working and explains the missing setup when a User
tries to sign in.

## AI providers

AI chat owns provider-neutral conversation history inside the selected local
workspace. The history sidebar supports search, rename, delete, and session
switching. Requests send a bounded window of completed local messages to the
selected provider; failed responses stay visible but are excluded from later
model context. The Web preview keeps this history only in memory.

The desktop app discovers a locally installed Codex CLI and uses its official
ChatGPT sign-in through Codex App Server. Run `codex login` once, or use the
ChatGPT row in MyBox settings. The detected plan name is display-only; MyBox does
not restrict the adapter to Plus or any other tier.

This adapter refuses API-key authentication so subscription use cannot silently
become metered API use.

When the installed Codex version advertises the capabilities, chat can list
enabled user/system skills and attach up to four of them to a single turn. It can
also generate one image through the ChatGPT/Codex image tool. Generated images
are validated and copied into private `ai-chat` storage; the WebView receives an
opaque resource ID rather than a filesystem path. Image generation is mutually
exclusive with Web search for a turn and may consume subscription allowance or
credits.

Type `/` in the composer to search the currently available tools and skills.
Use the arrow keys to move and Tab or Enter to apply a candidate. The composer
also discovers the signed-in Codex model catalog and each model's supported
Thinking levels. Subscription usage is shown as the remaining percentage in the
reported quota windows because Codex does not expose a remaining-token count.

OpenAI API is a separate setting. Its key is stored in the operating system
credential store and is never returned to the WebView or written to the workspace.
Requests use the Responses API, opt out of response storage, and do not enable
provider-hosted tools except the user-controlled Web-search capability. ChatGPT
and OpenAI API can search when the Web toggle is active; results keep visible,
clickable sources in local chat history. Commands, file changes, MCP, and other
provider tools remain blocked. API responses store their exact input, cached,
output, reasoning, and total token usage in local chat history; the composer shows
the current session total. Supported API models expose their Thinking selector.

Local LLM connects to an OpenAI-compatible Chat Completions server on loopback.
For example, configure `http://127.0.0.1:11434/v1` plus the exact local model name.
Remote endpoints, redirects, embedded credentials, and system proxies are rejected
by this initial adapter. Local LLM does not yet provide Web search.

OpenAI API and Local LLM currently report skill and image-generation capabilities
as unavailable. Their adapters can implement the same provider-neutral contract
later without changing chat history or UI ownership.
