# ADR 0032: Identify shared edits with Project member colors

- Status: Accepted
- Date: 2026-08-20

## Context

Shared Projects merge simultaneous edits, and history already records an actor
ID, but the open Page did not show who last changed a Page or Block. Re-reading
long profile IDs in every revision is slower than recognizing a stable visual
identity, especially with several collaborators.

## Decision

Each Project member has a Project-scoped Author color chosen from an eight-color
palette. An unconfigured account receives a deterministic fallback derived from
its profile ID, so it is identifiable immediately. The Project Owner can stage
member color changes in the enlarged Project settings dialog and save them with
the Project name from the persistent footer next to Close.

Local Projects store the color on their member records. Shared Projects store
the color map in the same Yjs document as the content so every peer converges on
the assignment. Page and Block records carry the immutable profile ID of their
last editor internally. Block badges and Page history render the account display
name with the configured color; they do not expose that storage identifier. The
Page header contains Project and revision metadata only. Author color is
descriptive and never grants access.

All changes go through `knowledge.project.members.list` and
`knowledge.project.member-color.set` Operations. A member may set their own
color; assigning another member's color requires the Owner role.

## Consequences

Collaborators can identify authors consistently without exposing email
addresses, credentials, or internal IDs. A color is not used alone: the account
display name remains visible for accessibility and to avoid relying on color
perception. Older data without profile presentation remains valid and uses a
neutral collaborator label until that account publishes its name.

## Implementation notes

`author-color.js` owns palette validation and fallback selection. `domain.js`
stores local metadata, while `yjs-document.js` syncs shared colors and last
editors. `KnowledgeView.jsx` stages settings changes and renders semantic color
buttons with pressed and focus states. The built-in Note App catalog version is
`1.10.0`. Shared account names and HTTPS avatar URLs are non-secret profile
presentation from ADR 0022 and converge in the Yjs document; authorization still
uses the immutable profile ID.
