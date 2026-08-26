# ADR 0042: Select and undo Note Blocks as structural edits

- Status: Accepted
- Date: 2026-08-26

## Context

Note previously treated Block deletion as an isolated button action. A deleted
Block could only be recovered by restoring an entire local Page history entry,
which also rolled back unrelated edits and was unavailable for a shared
Project. The editor also had no explicit selection model, so several Blocks
could not be acted on together.

Text inputs already own their native editing undo. A structural undo shortcut
must not consume the same `Ctrl+Z` while a User is typing.

## Decision

Note has an ephemeral **Block selection** scoped to the open Page. Each Block's
selection control toggles it, `Ctrl`/`Cmd` clicking a Block preview also toggles
it, and `Shift` click selects the inclusive range from the last anchor.
`Escape` clears the selection. Selection is represented by a pressed semantic
control, an accent marker, and a labelled action bar rather than color alone.

Deleting selected Blocks is one `blocks-remove` Page mutation. The editor first
captures each selected Block and the ID of its next surviving Block, then keeps
up to 20 successful deletion records for the current open Page. `Ctrl+Z` and
the visible “元に戻す” action submit a `blocks-restore` mutation using those
snapshots and anchors. The shortcut is intercepted only outside native text
editing controls, preserving the browser's character-level undo while typing.
Changing Page or Project clears the ephemeral selection and undo stack.

Local JSON Pages and shared Yjs Pages implement the same mutation vocabulary.
When every Block is deleted, both models retain one empty paragraph placeholder;
restoration replaces that placeholder by identity before inserting the other
Blocks. Undo is therefore a new synchronized structural edit, not a client-only
visual rollback.

## Consequences

Users can bulk-delete an arbitrary set or range of Blocks and recover one or
several recent deletions without reverting the rest of the Page. The behavior
is the same for local and shared Projects, and restored Page links and Block IDs
remain intact. The short-lived undo stack does not survive closing Note; durable
local recovery continues to use Page history.

## Implementation notes

Note `0.5.13` adds pure selection and restore-anchor helpers in
`editor-behavior.js`, the selection toolbar and shortcut handling in
`KnowledgeView.jsx`, and matching `blocks-remove`/`blocks-restore` handlers in
`domain.js` and `yjs-document.js`. The installed App Registry version is
`1.19.7`.
