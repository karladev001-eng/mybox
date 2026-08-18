# ADR 0019: Provide a Host-owned contextual assistant panel

- Status: Accepted
- Date: 2026-08-16

## Context

AI Chat was available only as a dedicated destination. A User working inside the
launcher, settings, or an App Surface had to leave that context to continue the
same conversation. Letting each App implement its own chat would duplicate
provider state and could encourage direct access to another App's private data.

## Decision

The Host provides one collapsible AI assistant panel on the right edge of every
non-chat surface. It reuses the `ai-chat` App's provider-neutral sessions,
composer, provider selection, tools, persistence, and authorization boundaries.
The panel may show a short context label supplied by the active Surface, but that
label grants no storage access or Operations and must not be treated as Page
content.

On a sufficiently wide desktop window the panel docks beside the active content.
At narrower widths it becomes an explicit overlay and moves focus into its
composer. The User can close it, start a new conversation, or expand the current
conversation into the full AI Chat surface without losing history.

An App Surface may publish display-only context through Host-provided Surface
props and may request that the Host toggle the panel. It does not import the chat
store, provider adapter, or another App's state. Agent work remains limited to
Host-authorized public Operations and existing provider capabilities.

## Consequences

AI assistance stays available without replacing the current App workflow, while
chat ownership and authority remain centralized. Future operation-aware context
can extend the Host contract without giving the panel or provider direct access
to App storage.
[ADR 0025](0025-agent-operations-from-the-assistant-panel.md) is that
extension: the label this ADR introduced grows into a structured context an
App can opt into, gated by the User's Confirmation level.

## Implementation notes

As of 2026-08-16, the React Host renders the existing `ChatView` in a compact
panel variant. Knowledge publishes its current Project/Page label and exposes a
panel toggle in its top bar. The label is included only as untrusted interface
context in the provider prompt.
