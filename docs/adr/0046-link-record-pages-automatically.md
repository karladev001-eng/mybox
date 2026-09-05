# 0046 — Link record Pages automatically

Status: accepted

Conversation and Context relations are persisted PageLinks, not just navigation
buttons. Context recording and a Host-mediated `knowledge.record.links.v1`
repair operation append deterministic link Blocks without rewriting messages,
model inputs or their content revisions. Repeated repair is idempotent and also
connects legacy Context and the Pages actually supplied as sources. It does not
infer semantic similarity or search for additional input.

Conversation and Context in the same Project receive reciprocal links. Across
Projects, Context stores an outgoing link; the reverse direction is an authorized
backlink, so private Record metadata is never automatically written into a shared
source Project. Repair only changes writable Pages and reads accessible targets.
Page reads combine live Project documents and filter backlinks by source access.
Links grant no access. Stored snapshots survive target deletion; automatic links
retain IDs through Trash and restoration and resolve current titles on display.

Link Blocks use the existing Block/PageLink and Yjs representation, with optional
`targetProjectId` and `recordRelation` metadata. No storage format replacement is
needed. Existing records are repaired when opened; new record writes reconcile
links before persistence. Link-only repairs do not advance message content
revisions. Same-Project local changes are saved together; transport commits are
flushed and repeatable after an interrupted repair.

## Verification

Core tests: 183 passed; package build passed. Tests cover persisted reciprocal
links, idempotent repair, Yjs round-trip, unchanged inputs, Trash/restore,
cross-Project access and Viewer write rejection. The browser fixture's
`?workspace&sameProject` and `?workspace` modes verify actual KnowledgeView
PageLink/backlink navigation, Markdown rendering and visible keyboard focus
on dark surfaces. Native desktop IME and OS DPI states were not rechecked:
this session exposes browser automation only. No native code changed in this
follow-up.

### Retained Host compatibility fix

A refreshed Surface can retain a Host registered before `record.links.v1` existed.
`readPageWithRecordLinks` skips unavailable optional repair and Viewer-only write
denial, then performs the authoritative Page read. It does not swallow storage
failures or read authorization errors. A desktop restart loads the new Host
operations and enables repair. Regression coverage includes the retained Host,
Viewer reads, failure propagation and repair-before-read ordering.

### Reload retained development Host definitions

The compatibility fallback restores reading but cannot activate an Operation
absent from the running Host. Vite now performs a full document reload for
changes to core runtime and Knowledge JavaScript definitions, including client
closures. React-only and CSS edits retain fast refresh. This rebuilds Operation
registrations using existing persistent storage and avoids repeatedly asking
users to restart the validation desktop. The hot-update hook is regression tested.
