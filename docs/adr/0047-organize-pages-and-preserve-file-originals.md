# 0047 — Organize Pages and preserve File originals

Status: accepted

The next migration starts with Folder and File. Prompt templates and generation
history remain with Image until the following delivery; graph visualization,
OCR, PDF text extraction and semantic retrieval remain later milestones.

Folders organize Pages within a Project without creating a permission or sharing
boundary. A Folder has a stable Page identity, can contain other Folders, and
cannot be moved below itself. Existing Pages start at the root and retain their
identities. A Folder must be empty before it is moved to Trash. Moving Pages
between Projects is not part of folder organization.

A File Page describes an immutable imported original (name, media type, size and
SHA-256). The original is copied into the Project store, not linked to an OS
path. Resource bytes stay outside the Yjs document and the search index. A group
sync endpoint stores resource chunks under the same Project membership checks;
metadata is published only after the resource upload succeeds. Downloads verify
the hash. Missing or inaccessible resources produce an explicit error, never
an empty replacement. No credentials or absolute paths are stored in Pages.

File Pages participate in ordinary PageLink, tag, search and Trash operations.
Original bytes are immutable; importing an edited original creates a new File
Page. Images can be previewed; other formats can be downloaded. Parsing PDFs or
executing file content is outside this delivery. Resource cleanup is deferred
until retained history and shared copies can be accounted for safely.

All mutations and resource reads pass through versioned Knowledge Operations
and Host authorization. Metadata uses the same local/Yjs projection; older
clients must update before writing the extended format.

## Implementation and verification

Knowledge App 1.22.0 writes schema 4; native Project manifests use version 4
and shared clients require record protocol 3. Originals are limited to 20 MB.
Existing notes, conversations, Context, IDs and original image resources are
retained. This does not migrate Image Prompt templates or generation history.

Core tests: 188 passed. Sync unit tests: 16 passed. Local live tests: 18 passed,
including multichunk original upload, read permissions, hash mismatch and
idempotency. Rust library tests: 37 passed, with 7 authenticated provider tests
ignored. Package and sync-server builds passed. Browser checks exercised dark
Folder creation, focus, disabled controls, themed selection, keyboard moves and
Escape. Native UI, native download dialogs, IME and OS DPI were not automated
because this session exposes only browser UI control; Rust storage behavior was
verified separately. Group servers require an explicit redeployment.

Folder navigation and controls are superseded by ADR 0048. The File original
storage and permission design remains in effect.
