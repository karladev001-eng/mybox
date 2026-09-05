# ADR 0045: Render chat Markdown with quiet message actions

- Status: Accepted
- Date: 2026-09-05

## Decision

Chat, Conversation Pages and Context answer previews use one React Markdown
renderer with GFM tables. Stored message text remains unchanged. Raw HTML is
disabled, Markdown images display their alt text without fetching remote content,
and HTTP(S) links use the existing external opener. Generated images retain their
existing explicit resource renderer.

Repeated message actions use small muted Phosphor icons with themed tooltips,
accessible names and 40 px hit areas. Secondary text actions are quiet and compact;
hover, pressed, focus and disabled states remain visible. FRONTEND.md records this
as the default product direction.

## Verification

Test semantic Markdown rendering, unsafe links/HTML and remote-image suppression.
Verify tables, code overflow, action visibility and keyboard focus in dark browser
previews, then run package tests/build. Native desktop UI checks remain separate.

Core tests: 179 passed. Package build passed with the existing chunk-size warning.
Dark browser checks confirmed semantic tables/lists/code, quiet icons, keyboard
focus and themed tooltips. Native desktop IME/DPI verification was not available.
