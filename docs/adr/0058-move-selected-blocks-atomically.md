# 0058 — Move selected Blocks atomically

Status: Accepted

Note editing supports moving selected Blocks together, preserving their Page
order. Selection actions expose up/down buttons; the focused move handle and
selection toolbar accept Alt+ArrowUp/ArrowDown without capturing text editing
or IME input. Clicking a move handle selects that Block for pointer/keyboard
actions. Dragging a selected Block moves the selection; dragging another moves
only that Block. Selection and keyboard focus survive successful movement.

The authorized Page update Operation adds `blocks-move`. Both JSON and Yjs
paths validate all source IDs and the destination before changing anything.
An anchor inside the selection is a no-op. Directional moves shift each selected
run one position, retaining the relative order of selected and unselected Blocks.
Unknown anchors fail rather than moving to the start. Existing single-Block
movement uses the same rules. Read-only and immutable records stay protected.

This is one structural transaction and preserves Block IDs, text, links and
metadata. It uses the existing Y.Array move representation: moved Blocks are
recreated, so simultaneous text edits to a moved Block have the existing
structural-move limitation. No schema or sync protocol change is required.
Pending saves block further structural moves; failures retain the selection.

The Block action rail stays inside the content grid with aligned 40px targets.
Narrow layouts place the rail above the text. This replaces the negative-offset
rail that clipped selection and drag controls outside the viewport on wide
windows. Read-only content does not reserve a blank action column.

Validation: all 232 core tests and the package build pass (existing chunk-size
warning remains). Tests cover source-order preservation, separated selections,
boundary no-ops, invalid destinations without partial deletion, one local
revision, restart, shared Viewer rejection, metadata preservation and peer
convergence. The isolated Windows build succeeds. Native Graphite/Light
selection and up/down controls, plus Alt+ArrowDown movement, were exercised.
Browser checks cover group drag, keyboard focus retention, delayed/failed save
and retry, and editing after movement. At 720/800/1066/1280/1600 CSS pixels,
action targets measure 40px, text columns align and there is no horizontal
overflow. Windows automated drag did not produce a move, so native drag remains
unverified; browser drag passed. OS IME and physical DPI were not retested.
