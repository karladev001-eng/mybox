# ADR 0011: Own the appearance of desktop controls

- Status: Accepted
- Date: 2026-08-15

## Context

MyBox uses a dark custom interface, but native browser/Windows popup rendering can
still appear inside controls such as model selectors. Those square, independently
themed surfaces break visual continuity and cannot be made reliable through
styling the closed `<select>` alone. The large square app cards also use more
space than their launcher content requires.

## Decision

`FRONTEND.md` is the repository source of truth for user-visible design work.
Agents must read it before changing UI and must treat exposed OS/framework default
rendering as a UI defect.

MyBox keeps semantic controls and native interaction where the entire surface can
be themed. When a popup cannot be themed completely, it uses an accessible custom
surface with explicit listbox semantics, keyboard navigation, focus handling,
outside-click dismissal, and token-driven states.

Model and Thinking selectors use the shared custom popup control. Provider usage
moves from the crowded composer controls to the chat header, where it describes
the current conversation/provider rather than the next prompt. The app collection
uses compact horizontal launchers showing icon, name, purpose, open affordance,
and an independent overflow menu instead of oversized square tiles.

## Consequences

- Popup visuals remain consistent in the Windows WebView dark theme.
- Custom listbox behavior has more implementation responsibility and therefore
  requires direct keyboard and focus verification.
- The composer retains more room for tools and prompt input.
- More apps remain scannable without turning the collection into a dense text
  table or hiding app purpose.

## Implementation notes

- `FRONTEND.md` defines tokens, states, list/popup behavior, and the UI review
  checklist.
- `mybox-app/src/ThemedSelect.jsx` owns the shared custom listbox, while
  `ChatView.jsx` owns header usage placement.
- `mybox-app/src/App.jsx` renders the app launcher collection.
- `mybox-app/src/styles.css` defines the semantic design tokens and all affected
  states without exposing a native select popup.
