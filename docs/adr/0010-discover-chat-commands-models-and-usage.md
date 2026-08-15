# ADR 0010: Discover chat commands, models, and usage

- Status: Accepted
- Date: 2026-08-15

## Context

The AI chat already exposes Web search, image generation, and explicitly selected
skills, but those controls are separated from the text-entry workflow. Users also
need to understand the selected model, its reasoning level, and the materially
different usage signals returned by subscription and metered API providers.

ChatGPT/Codex does not expose an exact remaining-token count for a subscription.
Its stable App Server surface exposes quota windows as `usedPercent` plus reset
times. OpenAI API responses expose actual input, cached-input, output, reasoning,
and total token counts for each request.

## Decision

The composer provides a provider-neutral slash-command palette. Typing `/` after
the start of the prompt or whitespace opens filtered tool and skill candidates.
Arrow keys move the active option; Tab, Enter, Space after an exact command, or a
pointer selection applies it. Applying a command removes only the command token
from the prompt and toggles the same explicit per-turn capability state used by
the visible controls. Slash commands do not bypass authorization or invoke a
provider by themselves.

Provider adapters expose picker-safe model metadata. ChatGPT/Codex models and
supported reasoning efforts are discovered from `model/list` and revalidated by
the native host before each turn. The OpenAI API adapter advertises the current
documented GPT-5.6 family plus the user's explicitly configured model. Local LLM
keeps its configured model and does not claim a standardized reasoning control.

Usage has two distinct representations:

- subscription usage is a live quota snapshot expressed as remaining percentage
  and reset time for primary and optional secondary windows;
- API usage is the exact token breakdown returned with a response, stored on the
  assistant message and summed for the current local chat session.

The interface labels these representations differently and never converts a
subscription percentage into a fabricated token count. Model and reasoning
selection is provider-scoped and applies to subsequent turns in the current app
run. Each completed message records the effective selection for history clarity.

## Consequences

- Keyboard users can discover and select tools and skills without leaving the
  composer.
- Provider model availability remains authoritative for ChatGPT/Codex and cannot
  be replaced by WebView-supplied arbitrary model or effort values.
- Subscription and API usage remain comparable at a glance without implying that
  they measure the same thing.
- API token accounting survives chat reloads because it is stored with local
  provider-neutral messages; live subscription quota is refreshed instead.
- Persisting preferred model/effort across application restarts is deferred until
  provider preferences receive a dedicated settings contract.

## Implementation notes

- `mybox-app/src-tauri/src/codex.rs` owns Codex model discovery, quota reads, and
  model/effort revalidation.
- `mybox-app/src-tauri/src/agent_providers.rs` extracts metered API token usage and
  validates reasoning effort.
- `mybox-app/src/ChatView.jsx` owns slash-menu focus, filtering, keyboard behavior,
  and compact model/usage controls.
- `mybox-app/src/core/chat-history.js` validates persisted model, reasoning, and
  token-usage metadata.
