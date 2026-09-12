# 0052 — Explore record links as a graph

Status: Accepted

## Decision

Start graph navigation with the open Page and its immediate incoming/outgoing
PageLinks. Selecting a neighbor opens that Page and recenters the graph. Notes,
conversations, Context, Files, Prompts and Generations share this navigation.
Existing links are authoritative; no inferred similarity links or second graph
store are introduced. Reads use existing authorized public Page Operations.

Read each destination before showing its title or kind. Omit inaccessible and
trashed destinations, but surface operational failures instead of showing a false
empty graph. Project ID plus Page ID forms node identity. Deduplicate repeated
Block links while retaining incoming/outgoing direction. Page through 12
neighbors for readable layouts without dropping the remaining relationships.

## Interface

A compact expandable graph sits beside existing link navigation below the Page.
Nodes are semantic buttons arranged in aligned columns around the current Page;
SVG lines are decorative and labels also convey direction and kind. Keyboard
navigation uses normal Tab and Enter. No popup, physics animation or storage
format change is required. Colors use existing theme tokens.

## Validation

209 core tests pass. Browser review confirms expansion and Tab/Enter navigation between linked Notes. Knowledge version is 1.24.0. Native desktop pointer states, IME and 100–200% DPI remain unverified because native UI automation is unavailable in this session.

The package build passes. Browser review also confirms the visible direction arrow and focus returning to the graph toggle after opening a neighbor.
