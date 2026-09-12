# 0054 — Group and drag the side graph

Status: Accepted

Place the workspace graph beside the Page, keeping both visible. Layout springs
combine stored links, normalized shared Tag labels and lightweight local textual
similarity. Similarity uses title/body terms (first 6000 body characters), including
Japanese character pairs; it is lexical, not embeddings or model inference.
Text candidates are bounded and the strongest three matches per Page are retained.
Common tags form sparse connected groups. Dashed affinity lines are presentation
only and never become saved PageLinks or grant access. Original Page counts and
link counts retain their meaning.

Dragging pins the selected node while the same force system moves its neighbors.
Release relaxes the graph for a bounded period without resetting node positions.
A drag does not open the Page; click and Enter do. Alt+arrow moves a focused node.
No external model calls or new persistence formats are required.

## Validation

212 core tests pass, including affinity generation and pinned-neighbor following. Browser review confirmed the side-by-side layout and dragging a node without opening its Page. Native desktop IME/DPI and dense real-data pointer testing remain unverified; native UI automation is unavailable. Knowledge version: 1.26.0.

Ctrl+G and the header graph control hide the entire side panel; the original centered Page layout returns while the graph's positions are retained. Stationary dragging and release now cool for 105 frames, and unpinned nodes are tethered to drag-start positions with a maximum 160 layout-unit displacement. Pointer movement reheats the simulation. A stationary hold no longer runs the repulsion simulation indefinitely. Knowledge 1.26.1.

Validation for 1.26.1: 213 core tests and package build pass. Browser Ctrl+G toggles the panel while the title input remains focused, and the hidden state restores the centered Page. The new physics test holds a distant pin for 400 steps and checks bounded neighbor drift and zero movement at zero cooling strength.

Knowledge 1.26.2 reduces the graph chrome to a transparent search field, Page/link counts and refresh. Remove graph title, fullscreen/zoom/fit buttons and legends. Ctrl+G remains in the Host header, and pointer/keyboard graph navigation is retained. Focus after opening a Page returns to graph search.

Validation for 1.26.2: 15 related tests and package build pass. Dark browser review confirms only search, counts and refresh remain. Native desktop state/DPI checks remain unavailable.

Knowledge 1.26.3 replaces the search placeholder with a quiet magnifying-glass icon. The input retains its accessible search name and clicking the icon focuses the field.

Knowledge 1.26.4 adds a draggable separator between Page and graph. The Page retains 20–80% of the content width; the ratio survives Ctrl+G toggles within the mounted workspace. Arrow keys move the focused separator, Home/End reach bounds and double-click resets to 56%. Pointer capture supports release outside the boundary and cancellation clears resize state. No stored record is changed.

Validation for 1.26.4: package build and 8 registry tests pass. Browser drag changed the ratio from 56% to 70%; Left adjusted to 68%, preserved through Ctrl+G hide/show. Native desktop DPI remains unverified.

Knowledge 1.26.5 removes the side-graph Page width/padding override. The Page inherits the same maximum reading width, responsive gutters and automatic horizontal margins used without a graph, centered inside the Page column.


Knowledge 1.26.6 adds bilingual, width-normalized command-palette discovery
including the existing graph command (ADR 0027). Ctrl+G remains an active-App
shortcut; command search changes neither authorization nor execution.
