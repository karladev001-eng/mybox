# 0048 — Search-first navigation and inline files

Status: accepted

This supersedes the Folder feature in ADR 0047. Knowledge navigation centers on
search, PageLinks and tags. Both left navigation columns start hidden and can be
toggled together. Project selection, search, Page creation and File import remain
available without either column. Search opens on focus even with an empty query,
supports multiple terms, ranks title matches before body matches and opens the
matching Block. IME composition must never activate a result prematurely.

Folder create/move Operations and Folder controls are removed. A writable legacy
Folder becomes a normal Note with PageLinks to its former children, retaining all
IDs and original Pages. Parent assignments are cleared through a Host Operation;
the repair is repeatable and also commits to live Yjs stores. Viewer data is not
rewritten. The existing schema and protocol can represent this migration.

Opening a File Page automatically displays raster images or a locally rendered
PDF. PDF.js renders untrusted PDF bytes to canvas without scripts, attachments,
remote URLs or embedded HTML. Only the current PDF page is rendered, with bounded
canvas dimensions and cancellation when navigating away. Original download is a
secondary action; there is no separate preview activation button. PDF text/OCR
indexing remains deferred.

Arrow keys select search results; Tab reaches the filter controls instead of
trapping focus in the input. PDF rendering follows the PDF.js canvas API
(https://mozilla.github.io/pdf.js/examples/).

## Implementation verification

Knowledge App 1.22.1 implements this decision. The core suite passes 191 tests
including repeatable Folder conversion through Yjs, multi-term search ranking,
Block targets and IME key guards. The package build passes. Browser verification
with the actual KnowledgeView confirmed hidden columns, recent-page navigation
across Projects, themed search filters, Tab access and automatic two-page PDF
rendering with disabled endpoint controls. Actual native IME composition, OS DPI
changes and a complete native pointer-state review remain unverified because
native UI automation is unavailable in this session.

### Command access (Knowledge 1.22.2)

Ctrl+P also lists commands for creating a Page in the current writable Project,
switching to an accessible Project and toggling both navigation columns. Typing
`>` limits the list to commands; command labels are searchable. Commands reuse
the existing authorized Page creation path and never create Pages for Viewers.
Dropdown triggers use quiet 12 px labels with transparent resting surfaces,
while preserving 40 px targets and all themed interaction states.

Command verification: 192 core tests pass. Browser checks confirmed Page creation
from search and keyboard-only Project switching/navigation toggling; package
build passes. Native IME/DPI and full native pointer-state checks remain unavailable.

### Revised search behavior (Knowledge 1.22.3)

This supersedes the 1.22.2 command list: Ctrl+P searches Pages and Project names.
Selecting a Project switches the current Project. Only a completed nonempty
query without any matching Page or Project offers creation, using the query as
the new Page title in the current writable Project. Ctrl+B toggles both left
columns through the App shortcut registry. The `>` command mode is removed.

Verification for 1.22.3: 193 core tests and package build pass. Browser checks
confirmed unmatched-query creation and suppression after the Page exists. The
Ctrl+B registry mapping is covered by tests; native IME/DPI checks remain unavailable.

### Workspace controls (Knowledge 1.22.4)

The assistant's left separator supports pointer dragging and arrow-key resizing
on desktop widths above 1100 px. Width is kept for the current Host session,
bounded to 320 px minimum and at least 360 px for the main workspace. Narrow
windows retain the existing overlay layout. Ctrl+N creates a Page; Ctrl+Delete
moves the active Page to Trash through existing authorized Operations. They do
not run for Viewers or from assistant inputs/dialogs. Page metadata displays the
persisted updatedAt in local time and follows normal Page refresh/sync.

Verification for 1.22.4: core tests cover Ctrl+N/Ctrl+Delete registration and
separation from Ctrl+Shift+N. Browser verification confirms the displayed update
time and separator resizing from 420 to 444 px with ArrowLeft. Actual native
pointer dragging, IME and OS DPI changes remain unverified.

### Outline and sequential entry (Knowledge 1.22.5)

Notes expose a quiet heading rail with an expandable, keyboard-accessible outline.
Entries use stable heading Block IDs and preserve levels; scrolling highlights the
current section. New untitled Pages select the title input; search-created Pages
start in Tags. Enter saves the title and moves to Tags, then saves Tags and enters
the first text Block. IME confirmation must not advance focus. Existing record
immutability remains in effect; only Notes allow continuing into body editing.

Verification for 1.22.5: browser checks confirmed heading jumps, selected outline
entries, title replacement followed by Enter to Tags and Enter to body, and
search-created Page focus starting at Tags. Core tests include stable heading IDs
and hierarchy; all 194 pass and package build passes. Native IME/DPI checks
remain unavailable.

### Quiet editor copy (Knowledge 1.22.10)

Remove the persistent Tag keyboard tutorial from visual layout, retaining its
screen-reader description and all keyboard behavior. A zero backlink count needs
no additional empty-state prose. FRONTEND.md makes this the default for routine
instructions and redundant state explanations.

Verification: 12 Tag/Registry tests and package build pass. No popup or input behavior changed. Native visual review remains unavailable with the current browser-only UI tooling.
