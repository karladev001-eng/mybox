# ADR 0034: Split pasted Markdown into Note Blocks

- Status: Accepted
- Date: 2026-08-22

## Context

Note stores a Page as independently editable Blocks, but the browser's default
paste behavior inserted an entire multiline clipboard value into the focused
textarea. Pasting a Markdown file or long text therefore produced one oversized
Block, even when headings, lists, and hard line breaks clearly described a
document structure.

The editor can also hold unsaved characters when paste occurs, and shared
Projects apply structural edits through Yjs. Splitting the content with a series
of separate updates could lose the visible prefix or suffix, create several
history entries, or leave collaborators with a different Block structure.

## Decision

When multiline text or a `.md`/`.markdown` clipboard file is pasted into an
editable Note text Block, Note applies one `block-paste` mutation. The mutation
includes the visible source text and selection, parses the clipboard value, and
replaces that selection with independently editable typed Blocks.

Ordinary hard lines become separate paragraph Blocks. Markdown headings,
quotes, checklists, dividers, math fences, bare URLs, and other supported syntax
retain their Block types. Consecutive bullet or numbered items remain one list
Block, and fenced code remains one code Block so internal line breaks keep their
meaning. Blank separator lines do not create empty Blocks.

The source Block is reused for the first result, its text before and after the
selection is preserved as surrounding Blocks, and Page links remain attached
only where their token still exists. Local and shared Projects use the same pure
splitter. The shared path updates the existing Y.Text for the reused Block and
inserts the remaining Blocks in one Yjs transaction.

Single-line clipboard text keeps native textarea paste behavior. Code, math,
and image Blocks also keep their existing paste behavior because multiline
content is intrinsic or the text is an opaque resource identifier. After a
structured paste, focus moves to the final pasted Block so editing can continue.

## Consequences

Long prose and Markdown can be pasted once and then rearranged, styled, linked,
or deleted Block by Block. The entire structural paste is one recoverable Page
revision locally and one convergent transaction in shared Projects. The parser
intentionally treats hard line breaks more strongly for clipboard input than
for the `markdown-set` document operation, which retains Markdown paragraph
semantics.

## Implementation notes

As of Note `1.12.0`, `editor-behavior.js` owns clipboard parsing and source
splitting, `domain.js` and `yjs-document.js` implement the common
`block-paste` mutation, and `KnowledgeView.jsx` handles multiline text and
Markdown files at the focused textarea.
