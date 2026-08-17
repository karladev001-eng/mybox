# ADR 0013: Use Projects as exclusive Page sharing boundaries

- Status: Accepted
- Date: 2026-08-15

## Context

Pages need simple organization now and a clear membership and permission boundary
for future collaboration. Allowing a Page to belong to several differently shared
containers would make access, synchronization, and deletion semantics ambiguous.

## Decision

Every Page belongs to exactly one Project. The App creates a Personal Project by
default, and future shared Projects apply membership and permissions to their
Pages as a group. A Page cannot belong to multiple Projects; Tags provide
cross-cutting classification without affecting ownership or access. Page links
cannot cross Project boundaries. Agents may search across several Projects only
when the caller is authorized for every Project included in the search scope.
Page-title uniqueness and Trash title reservations are enforced independently
within each Project, so different Projects may contain Pages with the same title.
Tags are also Project-owned: a Page may have several Tags, and equally named Tags
in different Projects are distinct. Tags never grant access or place a Page in a
second Project. Tags are flat and do not form a second containment hierarchy.

Each shared Project assigns every member exactly one Project role. A Project has
exactly one Owner, who controls membership, ownership transfer, and Project
deletion. Editors may create and change Pages, Blocks, and Tags and may move Pages
to Trash or restore them, but only the Owner may permanently delete a Page.
Viewers may only read and search. Project roles determine whether an action is
authorized at all; a User profile's Confirmation level only determines whether an
already-authorized action needs per-invocation confirmation. Consequently,
Autonomous confirmation never gives an Editor permanent-deletion authority or a
Viewer write access.

Search defaults to active Pages in the current Project. A user may explicitly
select particular Projects, all Projects they are authorized to read, and whether
Trash is included. Selecting all never bypasses per-Project authorization.

## Consequences

Project membership gives each Page one unambiguous sharing context. Moving a Page
between Projects may change who can access it and must therefore be treated as an
explicit operation rather than ordinary visual reordering. Cross-Project
references must use a different, explicitly authorized mechanism rather than
silently exposing a private Page through the Page-link graph.

## Implementation notes

As of 2026-08-16, the domain enforces one Project per Page, Project-scoped title
and Tag identity, same-Project PageLinks, and Viewer/Editor/Owner checks including
Owner-only permanent deletion. The editor can create and switch local Projects.
Membership invitations, ownership transfer, shared identity propagation, and
Host-issued per-Project data scopes are not yet implemented; the current App
adapter resolves operations to the local profile.
