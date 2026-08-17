# ADR 0017: Split App state from User-selected Project stores

- Status: Accepted
- Date: 2026-08-16

## Context

The knowledge App needs common settings and a Project catalog, while each Project
must be independently located, moved, backed up, shared, and eventually
synchronized with other Users. A single App-wide JSON store is too small for Page
history and search, while placing one SQLite file in a cloud-synchronized folder
would expose it to unsafe multi-writer file conflicts.

## Decision

The Workspace `apps/<app-id>/` namespace stores only App-common state such as the
Project catalog, settings, and non-content device metadata. Every Project uses a
User-selected local Project store for its Pages, Blocks, Tags, links, history, and
resources. The Host grants the App a Project-scoped storage port; the App never
receives an unrestricted filesystem path.

Each Project store contains a small Host-managed manifest. It records the immutable
Project ID, owning App ID, storage schema version, creation and migration metadata,
and relative layout. The Host validates this manifest before granting the storage
port. A filesystem path or directory name is never Project identity, and the
manifest contains no credentials or other secrets.

Copying a Project store does not create a new Project because both directories
retain the same immutable Project ID. An unavailable Project may be reconnected to
the copied or moved location, but the Host rejects registering a second available
copy as an independent Project. Creating an independent copy requires an explicit
Duplicate Project operation that assigns a new Project ID and new Page and Block
IDs, then rewrites internal PageLinks to those new identities.

Project duplication copies only the current active knowledge state: active Pages,
Blocks, Tags, PageLinks, and resources referenced by that state. Trash, Page
history, sharing membership and permissions, cloud synchronization configuration,
and other device metadata are excluded. The result is a new unshared local Project;
because title uniqueness is Project-scoped, it may retain the source titles.

If a cataloged Project store cannot be located and validated, the Project becomes
Unavailable. The common store retains its identity and location reference but no
Page bodies or search excerpts. Read, search, and write Operations fail with an
actionable unavailable result until the User reconnects the validated store; the
Host never creates a replacement directory silently.

Each local Project store uses an App-private SQLite database for transactional
content and a local full-text index. Other Apps and Agents use authorized
Operations rather than reading the database. A cloud or multi-user adapter
exchanges versioned Project changes through a synchronization contract; it does
not make a shared SQLite file or remote provider an alternate access path into App
internals. File-sync folders may be used for single-writer backup, not live
multi-user editing.

## Consequences

Projects become independently portable and syncable while common device state
stays small. The Host needs Project-store selection, scoped handles, availability
tracking, migration, and backup support. Cross-Project search must query each
authorized Project store and merge bounded results rather than relying on one
global content database.

## Implementation notes

As of 2026-08-16, the first end-to-end Knowledge slice deliberately persists its
state as `knowledge/state.json` behind the existing App-scoped storage port. This
proves the domain and Operation contracts but is not the target Project storage
layout. User-selected Project stores, Host-managed manifests and scoped handles,
SQLite/FTS, duplicate/reconnect workflows, backup, and cloud adapters remain to
be implemented before the storage architecture in this ADR is complete.
