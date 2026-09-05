# 0049 — Record-centered home and retired Workflow surfaces

Status: accepted

The Host home becomes a knowledge workspace entry: search, new Page, recent
records and accessible Projects. Image and conversation tools remain secondary.
Remove the launcher grid, persistent bottom navigation and redundant AI prompt.
Use graphite surfaces, restrained mint accents, fine dividers, deliberate spacing
and quiet controls throughout the Host; preserve existing semantic focus states.

Workflow UI, history navigation, keyboard commands and automatic runtime startup
are retired. Existing definitions/history remain on disk, untouched. The Host
opts out of workflow execution, including connector requests, rather than silently
running hidden schedules. Legacy saved Workflow destinations resolve to home.
The runtime retains its opt-in implementation for compatibility and tests.

Home reads records only through the Knowledge client and authorized Operations.
No second history store is introduced. Failed Project reads are disclosed and do
not prevent accessible results from appearing. Ctrl+P/Ctrl+N work from home and
handoff once to Knowledge after its workspace has loaded. Last Page restoration
remains unchanged.

## Verification

196 core tests and the package build pass, including retired-session routing
and disabled Workflow startup. Browser checks confirmed empty/populated home,
new Page focus, and reopening a recent Page without replaying creation. Native
IME, OS DPI and the full desktop pointer-state matrix remain unverified because
native UI automation is unavailable.

## Restrained color extension

Knowledge 1.22.7 and Image 0.5.6 extend the home language to settings, chat,
assistant, Notes and image generation. Shared mint/blue/amber tokens identify
record, conversation and Context/image roles. Soft tints replace unrelated
hard-coded selection colors. Settings group account/AI, record storage and
interaction controls with labeled separators. Functionality and permissions
remain unchanged.

Visual verification also found that hiding the chat sidebar left the main panel
in a zero-width grid column. The collapsed layout now uses one flexible column.

The color extension passes 196 core tests and the package build. Browser review
confirmed settings grouping, disabled/selected controls and expanded/collapsed
chat layout. Full native pointer-state, IME and OS DPI checks remain unavailable.

## Chat destination clarity

The default destination label resolves the stored private Record Project ID to
its current name (normally My Records); it is not a separate placeholder Project.
The default is omitted from the explicit choices unless already explicitly
selected. Remove the duplicate top-right new-chat action and sidebar title/close
row. The sidebar new-chat action and Host home icon remain.

Verification: 196 core tests and package build pass. Browser checks confirm My Records as the default, no duplicate destination, and removal of the two redundant chat controls. Native IME/DPI checks remain unavailable.

## Image template regression repair

Workflow request rejection must preserve the asynchronous API contract. A
synchronous throw bypassed Image's optional-library fallback, aborting the entire
template load. Retired requests now reject asynchronously, so built-in and local
templates remain available without re-enabling Workflows. Image 0.5.7 also uses
automatic header action tracks so the hidden history button leaves no empty gap.

Verification: all 197 core tests and the package build pass. Browser review confirms populated template shelves, rendered sample images and no retired-Workflow error. Full native pointer-state, IME and OS DPI checks remain unavailable through the current browser-only UI tooling.
