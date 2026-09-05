# ADR 0043: Make Knowledge the mandatory record foundation

- Status: Accepted
- Date: 2026-09-05

> ADR 0044 supersedes the same-Project Context restriction, per-send Page unit
> and always-on recording policy. Historical implementation notes below remain.

## Decision

MyBox is a local knowledge workspace for writing and reusing records. Knowledge
is mandatory; optional tools use its authorized Operations rather than owning
duplicate conversations. This supersedes the removable-Knowledge boundary of
0018 and the independent conversation ownership of 0007. Other tool state remains
private. Project roles, authorization, audit, stable identities and Yjs remain.

Pages have note, conversation and context kinds. Conversation messages and exact
outbound model inputs are immutable record Blocks. Titles and tags remain editable;
authored derivatives are Notes with provenance. Context is saved before each model
call, including agent follow-up calls. It records only inputs constructed by MyBox,
never credentials or provider-private context. Snapshot copies remain after source
edits or deletion, and inherit the destination Project's sharing and deletion rules.
Context sources must belong to the conversation Project. New and migrated chats
default to an unshared Project. Shared destinations require explicit selection.

Legacy history is backed up and imported without count truncation, with durable
identity mappings and restartable verification before cutover. Old history remains
a backup, never a second write target. Missing media blocks migration rather than
silently losing it. Old conversations have no invented input snapshots.

Markdown is interchange, not canonical storage. The next stages add folders,
files and prompts, then graph navigation, then semantic retrieval with Chunks
separate from editing Blocks. These stages are outside this implementation.

## Verification

Migration interruption/idempotency, retained metadata, record immutability,
authorization, exact input capture, Yjs convergence, compatibility, and existing
Note/Workflow behavior require automated tests. Desktop interaction and scaling
checks are required for the affected surfaces.

## Implementation notes

- The Knowledge model reads legacy schema 1 and writes schema 2. Project manifests
  accept 1/2 and become 2 before new writes; older Hosts cannot write through them.
- Record Operations have `.v1` IDs. Conversation history is paged; snapshot and
  message content are immutable through normal editing and history restoration.
- The Host migrator retains raw backups and per-session/media mappings in the old
  owner namespace. A missing image or failed verification prevents cutover.
- Conversation and Agent paths persist outbound input before invoking a provider.
  Native provider instructions share a bundled JSON definition with recording.
  Stale references fail before sending; later calls keep the initial source snapshot.
- Cloudflare handshakes require `records=1` in both directions. Existing group
  endpoints must be redeployed using the standard deployment UI; this change does
  not deploy servers or publish a desktop release automatically.
- Web preview data remains in memory. Actual desktop visual QA requires a native
  automation surface, which is unavailable in this session; browser QA is reported
  separately from native compilation and storage tests.

## Validation of this implementation

- Core tests cover immutable records, exact adopted history, per-call Agent input,
  empty and large legacy histories, ID/title collisions, metadata preservation,
  missing-media interruption/resume, Viewer authorization and Yjs convergence.
- The frontend/package builds, Sites packaging tests, sync-server tests and local
  live WebSocket integration tests pass. Rust library tests pass; seven authenticated
  provider integration tests remain ignored because they require a live Codex login.
- Browser checks exercised keyboard selection, the themed kind popup, conversation
  rendering, source-linked Note extraction and layouts at 1280, 1024, 853 and 640 CSS
  pixels. These are responsive checks, not native DPI or IME verification. Native
  desktop interaction/state coverage and authenticated provider sends remain unverified.
- No production data migration, endpoint redeployment or release was performed.
  Migration runs through the Host on the next desktop startup and retains its backup.
