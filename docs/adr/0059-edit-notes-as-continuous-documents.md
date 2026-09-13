# 0059 — Make Block editing direct and continuous

Status: Accepted

Notes retain a Block editor with directly editable typed Blocks, backed by
ProseMirror transactions and text-edit Undo/Redo. Mouse selection crosses Block
boundaries; Enter, Backspace, paste and typing create/join Blocks implicitly.
Clicking trailing whitespace places a caret at the document end. This is normal
document flow, not free-positioned canvas content. Existing themes remain intact.
Block controls appear beside the hovered/focused Block, with type conversion,
movement and deletion in a themed menu. Empty Blocks accept typing immediately;
slash opens type choices. Text selection reveals formatting. There is no separate
document/structure mode and no whole-document input border. This corrects the
initial implementation following the User's clarification: Block editing itself
must remain the normal interaction, as in Notion.

Knowledge Blocks remain canonical. The editor projection preserves stable IDs,
Block types, links and untouched source text. New `document-edit` Page mutations
carry a base and next Block projection. Changed/deleted content is checked against
that base before any write; structural edits additionally check current order.
Unrelated current edits survive. Conflicts retain the local draft for recovery,
never silently replace another writer. Yjs changes existing text in place, using
its existing minimal text delta. Neither ProseMirror JSON nor HTML is persisted.

Autosave coalesces typing and serializes writes. Acknowledgements cannot replace
newer typing or reset Undo. Page changes flush the captured old Page; they cannot
redirect a write to the next Page. Remote content updates refresh a clean editor
without becoming local Undo events. Editing history belongs to one open document.
Read-only and immutable-record restrictions remain at the Host boundary.

Remote HTML and images are never rendered directly from paste. Supported text
and formatting pass through the editor schema; stored media is resolved only
through the existing authorized resource client.

This refines the per-Block editing surface in ADRs 0042 and 0058; their structural
operations remain available alongside direct text entry, without switching modes.

## Implementation and verification

`PaperEditor`, `paper-document`, `paper-save` and `document-edit` separate the
interaction, canonical projection, save session and validated mutation.
`block-editor-actions` supplies typed edits and multi-Block movement as undoable
editor transactions; Alt+Enter opens actions and Alt+ArrowUp/Down moves a selection.
Moves preserve both text-selection endpoints and direction, allowing repeated
group movement. A range ending at the following Block's start does not select
that Block. Drag feedback shows the Block count rather than a duplicate control
and tooltip. Ctrl+Enter leaves the whole current Block (including lists/code),
focuses the next existing Block, or creates a trailing paragraph at the end.
Browser checks confirmed two consecutive group moves followed by a drag, with
both Blocks still selected, and Ctrl+Enter from a numbered list into a paragraph.
Legacy Markdown entry remains available: a standalone `---` paragraph becomes
a divider immediately, keeps its Block ID, and focuses a following empty paragraph
(reusing one when present). Code/inline/escaped markers do not convert. Bare triple
backticks and `$$` restore code/math conversion without requiring a trailing space;
numbered-list input accepts digit prefixes beyond `1.`.
Block previews use the same inline projection as editing, including nested
emphasis and literal punctuation. An immutable projection cache is bounded by
entry count and source size so unchanged paragraphs are not reparsed per keystroke.
Knowledge's installable version is 1.28.0; its runtime manifest is 0.5.15.

Failed drafts and Undo state survive Page navigation within the open Note
surface. They are memory-only, not crash recovery: closing the App discards an
unsaved draft. On an edit conflict the User can copy the draft before closing
and reopening Note to compare with the authoritative content. A save response
with unrelated remote edits cannot turn those unseen edits into the next local
write's deletions, even when typing continued during that request.

Validation covers canonical types, nested styling, text selection Undo, stable
split IDs, atomic conflicts, overlapping saves with remote changes, retry,
Host reload and Yjs peer convergence. The core suite passes 246 tests and the
package build succeeds. In an isolated Windows WebView2 fixture, mouse dragging
across paragraphs, range deletion/Undo, text Undo after save, and trailing-area
typing passed; Graphite and Light surfaces were inspected. Browser checks also
cover Enter, Redo, delayed saving across Page navigation, failure/retry and
combined formatting. Real Japanese IME composition and production shared-server
latency were not exercised in this fixture.

After the Block-UI clarification, browser verification also covers slash-to-heading
conversion, continued typing, the block action menu, movement and handle dragging.
Windows WebView2 verifies trailing-area input, slash choices, checklist entry,
Alt+Enter menu opening, keyboard focus/disabled-item skipping and menu movement;
synthetic native handle dragging did not produce a move, so native drag/drop is
not claimed as verified. Keyboard and menu movement remain available. New unit
coverage checks typed conversion, grouped movement/Undo and last-Block deletion.
