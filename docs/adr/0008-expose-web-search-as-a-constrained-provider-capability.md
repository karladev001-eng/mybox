# ADR 0008: Expose Web search as a constrained provider capability

- Status: Accepted
- Date: 2026-08-15

## Context

AI chat must answer requests whose accuracy depends on current information, such
as today's news. The initial provider boundary prohibited every tool, so even a
connected ChatGPT subscription correctly reported that it could not access the
Web. Enabling arbitrary network access would also enable commands, local file
tools, or unreviewed provider extensions that are outside chat's authority.

## Decision

Web search is an explicit, provider-declared capability. The chat composer exposes
an accessible Web toggle, enabled by default for capable providers. Each request
records whether the user allowed search; a provider may still answer without a
search when retrieval is unnecessary.

The ChatGPT subscription adapter may accept only Codex App Server `webSearch`
items during a search-enabled turn. It uses live hosted search in an ephemeral
thread while retaining the isolated temporary working directory, read-only
sandbox, no approvals, and blocked command, file-change, MCP, dynamic-tool, and
image-tool items.

The OpenAI API adapter uses the Responses API `web_search` tool with automatic
tool choice and asks for `web_search_call.action.sources`. The local-LLM adapter
declares no Web-search capability and rejects a search-enabled request. A future
host search adapter may extend local models without changing their private
storage boundary.

The native host validates returned source URLs as credential-free HTTP(S) URLs,
deduplicates and bounds them, and returns only title/URL metadata to the WebView.
The `ai-chat` app stores `webSearchUsed` and sources with the assistant message,
making the external read visible in local history. Source controls open through
the narrowly scoped native URL opener. Search never grants app-storage access or
authority to invoke another app.

## Consequences

- Current-information questions can use ChatGPT subscriptions or OpenAI API
  credentials without enabling general-purpose provider tools.
- Search results have visible, clickable provenance and remain understandable
  when a conversation is reopened.
- Search sends the bounded conversation prompt to the selected provider and may
  send a query derived from it to external search services.
- Local LLM remains offline-only until a separately authorized retrieval adapter
  is designed.

## Implementation notes

- `mybox-app/src/desktop/agent-providers.js` declares `webSearch` capability and
  forwards the per-request choice.
- `mybox-app/src-tauri/src/codex.rs` admits only hosted `webSearch` events when
  explicitly enabled and collects opened/cited HTTP(S) URLs.
- `mybox-app/src-tauri/src/agent_providers.rs` enables Responses API Web search
  and extracts both complete sources and URL-citation annotations.
- `mybox-app/src/core/chat-history.js` validates and persists source metadata.
- `mybox-app/src/ChatView.jsx` provides the toggle and source controls.
