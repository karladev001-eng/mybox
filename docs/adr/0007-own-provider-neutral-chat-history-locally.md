# ADR 0007: Own provider-neutral chat history locally

- Status: Accepted
- Date: 2026-08-15

## Context

The embedded AI currently handles one prompt at a time and shows the result in a
modal. Users need recognizable conversations, previous sessions, and enough
context to continue work. Provider-side conversation identifiers would couple
history to one subscription or API and would make switching providers ambiguous.

## Decision

MyBox includes an independent `ai-chat` app that owns its versioned session and
message history in its private workspace storage. A session stores a local title,
creation and update times, and ordered user and assistant messages. Assistant
messages record the provider that produced them; secrets and provider tokens are
never part of chat state. When a provider performs Web search, the assistant
message also stores the bounded, validated source titles and URLs plus a search-
used flag so provenance survives a restart.

The local session is the conversation source of truth. Each provider request is
built from a bounded window of completed local messages, so ChatGPT subscription,
OpenAI API, and local-LLM adapters share the same history without sharing
provider-side thread identifiers. Failed responses remain visible as recoverable
conversation state but are not sent back as model context.

If the selected provider is not connected, MyBox preserves the user's message
and adds a visible connection error to the session. The attempt stays in context
for the user instead of being discarded or navigating away from the chat.

The chat interface uses a session sidebar, an active-session indicator, a
readable message column, and a persistent composer. New, select, search, rename,
and delete actions operate only on `ai-chat` storage. Removing a session does not
delete provider account history because MyBox does not use provider history as a
storage adapter.

Chat responses remain untrusted text. Any request to read or write another app
continues to use the public operation, authorization, approval, and audit path
defined by ADR 0003 and ADR 0005.

## Consequences

- Conversations survive application restarts and provider changes when a desktop
  workspace is selected.
- The context window is intentionally bounded; the visible local transcript may
  be longer than the portion sent to a provider.
- Cloud sync, cross-device history, attachments, branching, and provider-native
  thread import are deferred.
- The Web preview uses an in-memory storage adapter and does not promise history
  across page reloads.

## Implementation notes

- `mybox-app/src/core/chat-history.js` owns validation, immutable history updates,
  title derivation, and bounded provider prompt construction.
- `mybox-app/src/desktop/chat-history.js` binds the chat app to native app-scoped
  storage or the Web preview's in-memory driver.
- `mybox-app/src/ChatView.jsx` owns the desktop and narrow-screen chat interface.
- ADR 0008 defines how Web-search provenance enters this provider-neutral state.
- ADR 0009 adds bounded skill labels and opaque generated-image references to
  the local transcript without storing image bytes in chat JSON.
- ADR 0010 records the effective model, reasoning effort, and validated API token
  breakdown on completed assistant messages.
