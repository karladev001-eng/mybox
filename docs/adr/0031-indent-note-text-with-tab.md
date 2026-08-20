# ADR 0031: Indent Note text with Tab

- Status: Accepted
- Date: 2026-08-20

## Context

Note Blocks are edited in multiline text areas, but Tab moved focus out of the
Block. Writing nested prose, code-like text, or list continuations therefore
required manually inserting spaces on every line.

## Decision

While a Note Block editor has focus, Tab indents the current line or every line
touched by the selection by two spaces. Shift+Tab removes one level. The Page
link candidate picker keeps its Arrow, Enter, and Escape behavior while Tab
continues to mean indentation in the Block editor.

The operation remains a normal `block-update`, including in a shared Project,
and restores the selection after the edit so typing can continue in place.

## Consequences

Users can structure text without leaving the keyboard. Focus traversal still
works everywhere outside an active Block editor, and the stored text remains
portable plain Markdown rather than containing tab control characters.

## Implementation notes

`editor-behavior.js` owns the line and selection transform, with tests for
indent and outdent. `KnowledgeView.jsx` applies it before other Block-level key
handling. The built-in Note App catalog version is `1.9.0`.
