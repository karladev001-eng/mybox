# ADR 0033: Keyboard-navigate Note Page search results

- Status: Accepted
- Date: 2026-08-20

## Context

`Ctrl+P` moved focus into Note's Page search field, but the search results were
only rendered in the separate Page list. A keyboard User could enter a query
without being able to inspect and open a result in the same focused interaction.

MyBox's general popup convention lets Tab close a popup and continue through the
normal focus order. Page search explicitly needs a faster selection loop in
which repeated Tab presses scan candidates before Enter opens one.

## Decision

When Note's Page search contains text, it displays up to seven matching Pages in
a themed combobox popup below the field. The active candidate is represented by
`aria-activedescendant` and `aria-selected`, and is distinguished with both a
visible icon and a selected surface.

Tab moves to the next candidate, Shift+Tab moves to the previous candidate, and
both wrap at the ends. Enter opens the active Page, clears the query, closes the
popup, and moves focus to the editor. Arrow keys, Home, End, Escape, pointer
hover, and pointer activation remain available as complementary controls.

This Tab behavior is an intentional, Note-specific exception to the general
popup convention because the User explicitly treats Tab as candidate selection
inside Page search. If there are no candidates, Tab is not intercepted and
continues through the normal focus order.

## Consequences

Page search can be completed without leaving the keyboard or moving focus out
of the search field. The separate Page result list remains available, while the
popup supplies immediate context including Project, Trash state, and excerpt.
The pure candidate filter and key-action resolver can be tested without a DOM.

## Implementation notes

As of Note `1.11.0`, `src/knowledge/search-behavior.js` owns normalized candidate
filtering and keyboard actions. `KnowledgeView.jsx` renders the accessible
combobox and `knowledge.css` supplies the dark popup and complete interaction
states.
