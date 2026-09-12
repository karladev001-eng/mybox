# 0053 — Show the whole workspace graph

Status: Accepted

Supersedes ADR 0052's one-hop layout and neighbor pagination. The user requested
an Obsidian-like overview of the entire Page structure.

Read every authorized Active Page through existing public Operations, including
isolated Pages. Edges retain stored direction and cross-Project identity; excluded
destinations produce no edge. No similarity links or separate persistence are
introduced. Cancel outdated loads, bound read concurrency and report failures.

A stable force layout draws nodes and edges in an SVG canvas. Large graphs sample
repulsion calculations rather than dropping records. Search highlights matching
Page/Project names. Zoom controls, background dragging, keyboard pan/zoom, fit and
fullscreen support exploration. Nodes open Pages with Enter or click. Kind colors
use existing theme tokens and are accompanied by labels and accessible names.

Knowledge version: 1.25.0. This change does not change storage or sync versions.

## Validation

210 core tests and the package build pass. Related tests cover isolated nodes, cross-Project identity, denied destinations and cancellation. Browser review confirms all-Page counts, node rendering, zoom and full-screen controls in the dark theme. Native pointer/IME/DPI and large real-workspace rendering remain unverified because native UI automation is unavailable.
