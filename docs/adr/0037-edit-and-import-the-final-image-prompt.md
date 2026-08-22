# ADR 0037: Edit and import the final Image Prompt

- Status: Accepted
- Date: 2026-08-22

## Context

Image compiled the selected subject, templates, ratio, references, and extra
input into a read-only Final Prompt. Users could inspect that text but could not
refine it as a whole or reuse a complete prompt stored in a Markdown file, text
file, or Note Page.

Importing a Note Page by reading Note storage would violate App isolation. A
permanent Connection is also too heavy for an explicit one-time User import.

## Decision

The Final Prompt panel is an editable draft. Until edited, it follows the current
compiler output. Editing or importing replaces it with an explicit override;
the User can rebuild it from the current controls at any time. Generation stores
and submits the exact override, including when the separate subject field is
empty, subject to the existing 16,000-character limit.

Import accepts UTF-8 Markdown and plain-text files as complete Prompt text. It
does not retain a live file link. The Import menu offers Note Page only while the
shared Host has the Note manifest registered. Note exposes
`knowledge.page.markdown.read`, a read-only, authorized Operation that returns
the Page's current Markdown body and revision. Image invokes that Operation as a
User through the shared Host and copies the returned text into its draft; it does
not import images or read Note storage.

The Note Page picker reads Page and Tag summaries through Note's existing public
Operations and filters locally by normalized title or Tag text. Search does not
read Page bodies; the Markdown body is requested only after the User chooses a
Page.

## Consequences

Template changes do not silently overwrite a manually edited or imported draft.
Rebuild is an explicit replacement and restores the compiler result. Generation
history remains self-contained because it stores the submitted Final Prompt,
while imported files and Note Pages continue to evolve independently.

Removing or disabling Note removes only the Note Page choice. Markdown and text
imports, Prompt editing, template compilation, and image generation continue to
work without Note.

## Implementation notes

Image `0.4.1` adds Final Prompt overrides, file import, the conditional Note Page
picker, and exact override submission. Note manifest `0.1.5` and Registry
`1.14.1` add the Markdown read Operation. Image checks the live shared Host
manifest rather than assuming Note is installed.
