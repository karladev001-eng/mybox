# ADR 0044: Collect Context by conversation in a private Record Project

- Status: Accepted
- Date: 2026-09-05

## Decision

Context recording defaults on and is a persistent Host preference. Each send
captures its preference once. A private Record Project, identified by the existing
migration checkpoint Project ID, owns one Context notebook per conversation.
Completed turns are immutable; later turns append. This supersedes ADR 0043's
same-Project Context restriction and one-Page-per-send rule.

Host Operations check source read and destination write permissions independently.
Snapshots retain copied input and provenance after source edits/deletion. Links
never grant permission. A shared default Record is replaced for future recording,
without moving existing records. Old Context Pages and IDs remain linked.

Users select completed turns and preview questions, answers and Context before
copying them to a writable shared Project. Copies are immutable and do not follow
future conversation changes. Required images are read through the resource broker
and embedded as validated raster data in the destination document so peers can read
them without access to the source workspace. Missing images prevent the copy.

## Compatibility and verification

Context v2 Operations coexist with v1. Knowledge schema 3, Project manifest 3 and
sync records protocol 2 prevent older clients rewriting new records. Settings with
no recording preference default on. Verify cross-Project authorization, immutable
turns, persistence failures, legacy links, selective fixed sharing and media sync.

## Implementation notes and validation

- Context reads expose an authorized session-conversation link from the persisted
  Project/Page IDs. The notebook displays it above turn details automatically,
  including legacy Context; no user-authored link or migration is needed. Current
  conversation titles are resolved on read. Unavailable targets are disabled.
  New fixed copies retain the conversation IDs without granting source access.

- The Host resolves the private destination once per recorded send. OFF turns
  retain an explicit message marker; recording settings cannot change mid-turn.
- Old per-send Context Pages are indexed when their conversation Context is opened
  or a new turn is recorded. Their bodies, Page IDs and original links stay intact.
- Preview tokens bind the selected turns and destination. Changed previews fail
  before copying; copy IDs make retries idempotent. Inputs and image bytes are
  resolved through authorized Operations and the resource broker.
- Core tests: 177 passed. Sites packaging: 4 passed. Sync unit tests: 16 passed;
  local WebSocket integration: 11 passed, including rejection of protocol 1.
  Rust library: 35 passed, 7 authenticated-provider tests ignored. Builds pass
  with the existing frontend chunk-size warning.
- Browser checks cover the setting switch, keyboard destination selection,
  turn details, preview, fixed-copy creation, Escape/focus restoration and narrow
  layouts. The manual fixture uses memory and a simulated shared destination.
  Native IME/DPI and authenticated model sends remain unverified because the
  session has no native automation surface or authenticated provider test run.
- Existing shared endpoints require redeployment of the protocol 2 bundle.
  This change does not deploy endpoints or publish a desktop release.
