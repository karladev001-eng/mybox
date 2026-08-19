# ADR 0012: Own a block-based knowledge graph in MyBox

- Status: Accepted
- Date: 2026-08-15

## Context

The planned note-taking App needs Markdown authoring, Notion-style block editing,
links between pages, agent-friendly retrieval, and a path to future collaborative
editing. Making an Obsidian vault authoritative could reduce initial work, but it
would bind MyBox identity and editing semantics to an external application.

## Decision

MyBox owns the authoritative Pages, ordered Blocks, and links in the App's private
state. Each Block has a stable identity, a structural type, and structured content
so it can be rendered, referenced, and changed independently. Markdown markers
are authoring shortcuts that immediately transform the current Block; Markdown is
also an import/export representation, not the authoritative in-app representation.
Page titles are unique within their Project, while stable Page identities
keep internal links intact across renames. Title uniqueness ignores surrounding
whitespace, letter case, and full-width versus half-width character differences,
while the user's display spelling is preserved. Obsidian is neither a runtime
dependency nor a second writable source of truth.

Pages do not form a parent-child containment hierarchy. Organization and sharing
use separate concepts, and Page links express references rather than ownership or
containment.

A Page link always targets an active Page identity. The `[[...]]` authoring
surface searches active and trashed Pages and offers an explicit create action
when no Page matches. Selecting an active Page creates the link; selecting a
trashed Page restores it and creates the link; choosing the create action creates
the Page and link together. Normal authoring does not persist unresolved links.

Normal Page deletion moves the Page and its Blocks to Trash and converts every
incoming Page link to ordinary text containing the Page's current title. Trashed
Pages remain restorable but normal browsing and the default search scope exclude
them. An explicit Trash search may retrieve them. A trashed Page keeps its title
reservation, so authoring the same Page link restores it instead of creating a
second Page.

Restoring a Page does not turn text produced by its earlier deletion back into
Page links. Only links explicitly authored after restoration participate in the
Knowledge graph.

Permanent deletion may target an active or trashed Page. It converts any incoming
Page links to ordinary title text, removes the Page and its Blocks, and releases
the title for reuse.

## Obsidian interchange

One Project imports from or exports to one Obsidian-compatible Vault. Each Page is
represented as a title-named Markdown file, Page links use `[[title]]`, Tags use
YAML frontmatter, and structured Blocks serialize in Page order. Export includes
active Pages by default and includes Trash only when the User explicitly selects
it. A MyBox Workspace containing several Projects is never treated as one Vault.

Exported frontmatter reserves MyBox Page identity and base revision metadata.
Re-import is an explicit action that matches existing Pages by identity, never by
title alone, and produces a Change proposal instead of applying changes
automatically. A Page unchanged since export can accept the reviewed difference;
concurrent MyBox and Vault edits are presented as a conflict. New files propose
new Pages, and accepted changes create normal Page revisions. MyBox does not watch
the Vault for continuous bidirectional synchronization.

A file missing from a re-imported Vault does not propose Page deletion because a
partial copy, move, or external synchronization failure is indistinguishable from
intentional removal. Re-import proposes additions and updates only; deletion must
be performed in MyBox or through a future explicit deletion marker.

## Revision and recovery

Block changes are automatically saved as completed editing operations. The editor
provides immediate Undo and Redo, while durable Page history retains User and
Agent changes for 30 days across App restarts and identifies the actor. Restoring
an earlier state creates a new revision instead of deleting later history. Trash
retains Page history; permanent deletion removes the Page, Blocks, and history
together.

## Initial implementation scope

The first editor supports Paragraph, Heading 1–3, Bulleted list, Numbered list,
Checklist, Quote, Code block, and Divider Blocks. Inline content supports bold,
italic, strikethrough, inline code, external links, Page links, and Tag input.
Tables, images, attachments, and embedded content are deferred until the host has
the required resource-storage support and their round-trip behavior is decided.
Images and URL embeds have since been decided in
[ADR 0026](0026-embed-images-and-urls-in-knowledge-blocks.md); tables and
non-image attachments remain deferred.

## Consequences

MyBox can evolve block-level agent citations and collaboration without adopting
Obsidian's storage model. Markdown round-tripping may be loss-aware because some
MyBox Block types and metadata will not have a lossless Markdown equivalent.
Agents and other Apps access the graph only through host-authorized Operations.

## Implementation notes

As of 2026-08-16, the Knowledge App implements stable Page and Block identities,
the initial structural Block types, Markdown-prefix conversion, atomic PageLink
creation, Trash link-to-text conversion, title reservation, restoration, permanent
deletion, and 30-day revision history. Bulleted and numbered list items are stored
as newline-separated items in one structured list Block; Enter continues that
Block and Enter on an empty item exits to a Paragraph Block. The first editor
exposes these behaviors through Host Operations. Inline rich-text marks, immediate
Undo/Redo, and Obsidian import/export remain follow-up work.
