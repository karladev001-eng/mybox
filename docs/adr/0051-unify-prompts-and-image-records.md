# 0051 — Unify Prompts and image generation records

Status: Accepted

## Decision

Knowledge owns one Prompt Page per user template and one Generation Page per
image attempt. Built-in templates remain bundled catalog assets. Image keeps its
UI, drafts, resume position and disposable provider resources; it reads and writes
records through Host-authorized versioned Knowledge Operations. Normal Page
editing cannot rewrite generated evidence; Prompt changes use template operations
and increment the record version. Notes can be extracted for free editing.

The Host resolves the existing private Record Project through the conversation
store's saved ID. It orchestrates owner-exported backups, durable identity/media
mappings and idempotent import. No migration silently skips missing images or
truncates history. Cutover follows data and image verification; legacy stores
remain backups and receive no new record writes. Shared Record destinations are
rejected; existing records stay where they were stored.

Original images become immutable Project File records, linked to Generation
Pages along with selected Prompt Pages. Provider input/output is fixed when the
attempt ends. Interrupted attempts are not automatically retried. Source edits
do not rewrite the saved final Prompt or references. Existing Project role,
Trash, restore, purge, Yjs and compatibility rules apply.

## Implementation and validation

Knowledge schema and native Project manifests are version 5; sync protocol is 4.
After verification, Image's old state path becomes a schema-2 cutover marker.
Raw state, template Markdown and provider images remain in the legacy owner as
backups; old Image clients reject the new marker rather than append stale history.

The Host supplies a Record destination resolver after loading the existing
conversation checkpoint. Inner record work uses the current User's Knowledge
client and Project checks; outer Image Operations retain caller authorization.
Requests carrying a different Profile ID are rejected by the runtime adapter.
No App reads another App's storage. File originals are verified byte-for-byte;
provider references are materialized as disposable Image cache resources only
when executing a new explicit attempt.

Generation Pages preserve final Prompt, selected template versions/text,
optional imported Note provenance, references and provider result metadata.
Their image is shown inline and other originals/Prompts are PageLinks. Prompt
and Generation filters join common search. Quiet Page icons open records from
Image; Markdown and Note extraction reuse existing record UI. Restoring Trash
uses Page lifecycle rather than rewriting completed inputs.

Validation: 205 core tests, 16 sync unit tests, 19 server integration checks,
7 live client checks and 37 Rust tests pass (7 existing Rust tests ignored).
Frontend and embedded sync bundles build. Browser review confirmed built-in
catalog loading, new Prompt creation and navigation to its private My Records
Page. Tests include 205 same-titled templates, ID collisions/duplicates, missing
images, restart/retry, byte verification, immutable inputs and save-before-model.
The integration suite's expected protocol number was updated after its Viewer
assertion exposed the stale expectation. Actual provider generation, full native
pointer/IME/DPI checks remain unverified with browser-only UI tooling.

Image 0.6.0 and Knowledge 1.23.0 advertise the update. Existing shared sync
servers must be updated before reconnecting these clients. No release is made
as part of this implementation.

Image 0.6.1 preserves native string rejection messages in generation records and
Workflow failures. Tauri rejects Rust errors as strings, so reading only
`error.message` hid the provider failure behind a generic message. A regression
test covers persistence and retrieval of that detail. This corrects diagnostic
loss; the reported real-provider failure originally needed reproduction.

### Verification follow-up — 2026-09-12

The user confirmed successful real-provider image generation with the current
implementation. This closes the outstanding generation smoke check; it does not
establish exhaustive provider, native UI or legacy-data migration coverage.
Legacy backups remain retained. Workspace-specific migration and endpoint
deployment are tracked separately in `../migration-status.md`.
