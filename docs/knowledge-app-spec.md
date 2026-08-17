# MyBox Knowledge App Specification

- Status: Accepted implementation baseline
- Date: 2026-08-16
- Planned App ID: `knowledge`

## 1. Purpose

The Knowledge App is MyBox's authoritative, local-first environment for writing,
organizing, linking, searching, and safely changing personal or shared knowledge.
It combines a Notion-style block editor with Markdown authoring shortcuts and an
agent-readable Page graph. Obsidian is a compatible interchange view, not a
runtime dependency or alternate source of truth.

The words **MUST**, **SHOULD**, and **MAY** describe required, recommended, and
optional behavior. Domain terms have the meanings defined in
[CONTEXT.md](../CONTEXT.md). The architectural reasons behind this specification
are recorded in [ADR 0012](adr/0012-own-the-knowledge-graph-in-mybox.md) through
[ADR 0017](adr/0017-split-app-state-from-user-selected-project-stores.md).

## 2. Product goals

The App MUST provide:

1. A content-first, Notion-style editor composed of independently addressable
   Blocks.
2. Markdown-like typing that immediately becomes structured, readable content.
3. Stable Pages, PageLinks, Tags, backlinks, and Block-level search results that
   Agents can use through authorized Operations.
4. Local authoritative storage with explicit Project boundaries and portable
   Project stores.
5. Reversible ordinary editing and deletion, durable history, and explicit
   treatment of destructive actions.
6. A data and mutation model that can later support cloud sharing and real-time
   simultaneous editing without replacing Page or Block identities.

## 3. Initial non-goals

The initial release does not include:

- continuous or bidirectional Obsidian synchronization;
- cross-Project PageLinks;
- nested Pages, nested Projects, nested Tags, or folder semantics;
- real-time collaboration, presence, live cursors, or a CRDT;
- embedding-based retrieval or provider-hosted indexing;
- tables, images, attachments, embeds, or arbitrary plugin Blocks;
- a cloud database that bypasses the owning App's Operations;
- multi-writer use of a SQLite file through a generic file-sync folder.

These are deferred capabilities, not alternate initial implementations.

## 4. App and authority boundary

`knowledge` is an independent MyBox App. It owns its Project catalog, Pages,
Blocks, Tags, PageLinks, history, search projection, and interchange metadata.
Other Apps, Flows, and Agents MUST use Host-mediated, versioned Operations and
events. They MUST NOT read a Project database or App-common state directly.

Local Workspace and Project-store data are authoritative. Cloud storage, future
sharing, backup providers, and Obsidian Vaults are adapters that exchange
validated data or versioned changes. None is a second writable source of truth.

## 5. Domain model

| Entity | Required identity and state | Ownership |
| --- | --- | --- |
| Project | Stable Project ID, display name, availability, sharing state | Knowledge App; exactly one Owner |
| Project membership | User profile ID and one Project role | One Project |
| Page | Stable Page ID, title, normalized title, Active/Trash state, revision | Exactly one Project |
| Block | Stable Block ID, structural type, structured content, order, revision | Exactly one Page |
| Tag | Stable Tag ID, display label | Exactly one Project; many-to-many with Pages |
| PageLink | Source Block identity and target Page identity | One Project |
| Page revision | Page and Block state, actor, timestamp, revision identity | One Page |
| Change proposal | Proposed mutations, base revisions, author, review state | Authorized target Project |

### 5.1 Global invariants

1. Every Page belongs to exactly one Project.
2. Pages and Tags are flat; neither creates a containment hierarchy.
3. Every PageLink starts and ends in the same Project and targets an Active Page.
4. Page, Block, Project, and Tag identity MUST NOT depend on a title, filesystem
   path, display order, or current device.
5. A Page title is unique across Active and Trash Pages within its Project.
6. Title comparison trims surrounding Unicode whitespace, applies Unicode width
   normalization, and compares without letter case. Display spelling is retained.
   A title that is empty after normalization is invalid.
7. The Knowledge graph contains Active Pages and their active PageLinks. Trashed
   content is retained but excluded unless a Search scope explicitly includes it.
8. All content mutations carry the revision they intend to change. A stale write
   MUST fail as a conflict and MUST NOT silently overwrite newer state.

## 6. Projects, Tags, and sharing

The App creates a Personal Project for a new profile. All new Pages default to the
currently selected Project. A User may create more local Projects and choose each
Project store directory.

Tags are flat, Project-local labels. A Page MAY have several Tags and a Tag MAY be
applied to several Pages. Tags do not grant access, change ownership, or permit a
cross-Project PageLink. Equally named Tags in different Projects are independent.

### 6.1 Project roles

Every member of a shared Project has exactly one Project role:

| Capability | Owner | Editor | Viewer |
| --- | :---: | :---: | :---: |
| Read and search Active Pages | Yes | Yes | Yes |
| Read Trash when explicitly selected | Yes | Yes | Yes |
| Create and edit Pages, Blocks, and Tags | Yes | Yes | No |
| Move a Page to Trash and restore it | Yes | Yes | No |
| Permanently delete a Page | Yes | No | No |
| Manage members and roles | Yes | No | No |
| Transfer ownership | Yes | No | No |
| Permanently delete the Project | Yes | No | No |

A shared Project has exactly one Owner. The sole Owner MUST transfer ownership
before leaving or being removed. An Agent or Flow acts with the Project role of
the User profile on whose authority it runs; an Operation grant cannot elevate
that role.

Project role answers whether an action is authorized. Confirmation level answers
whether an already-authorized Agent action needs a prompt. These checks are
independent, so `Viewer + Autonomous` remains read-only.

## 7. Editor behavior

### 7.1 Canonical content

Structured Blocks are canonical. Raw Markdown is neither the stored Page body nor
the editor's internal source of truth. Inactive Blocks render as readable content;
the focused Block remains directly editable without switching the whole Page into
a separate source mode.

The initial structural Block types are:

- Paragraph;
- Heading 1, Heading 2, and Heading 3;
- Bulleted list item;
- Numbered list item;
- Checklist item;
- Quote;
- Code block;
- Divider.

Initial inline content supports bold, italic, strikethrough, inline code, external
link, PageLink, and Tag input.

### 7.2 Immediate Markdown conversion

When a recognized marker is typed at the beginning of an editable text Block and
its terminating space or delimiter is entered, the editor MUST replace the marker
with the corresponding structured Block immediately. At minimum:

| Typed prefix | Result |
| --- | --- |
| `# `, `## `, `### ` | Heading 1, 2, or 3 |
| `- ` or `* ` | Bulleted list item |
| A numeric marker such as `1. ` | Numbered list item |
| `- [ ] ` or `- [x] ` | Unchecked or checked Checklist item |
| `> ` | Quote |
| A triple-backtick fence | Code block |
| `---` followed by completion of the Block | Divider |

The marker is not retained as visible content after conversion. Immediate Undo
MUST restore the pre-conversion text. Import and paste MAY parse larger Markdown
fragments, but must produce the same typed Block model.

### 7.3 Saving and revisions

Completed editing Operations autosave. The UI provides immediate Undo and Redo
for the editing session. Separately, durable Page history retains User and Agent
changes for 30 days across restarts and identifies the actor. Restoring an older
revision creates a new revision; it does not erase the intervening history.

Page and Block mutations MUST be atomic at the Operation boundary. They carry an
expected Page or Block revision and return the new revision. Revision conflict
responses include enough identity and revision metadata for the caller to reload
or create a Change proposal, but MUST NOT leak unauthorized content.

## 8. PageLink behavior

Typing `[[` opens a themed Page picker scoped to the current Project. It searches
both Active and Trash Pages while presenting their state clearly.

| Selection | Atomic result |
| --- | --- |
| Existing Active Page | Create a PageLink to its stable Page ID |
| Existing Trash Page | Restore the Page, then create the PageLink |
| Explicit create action | Create the Page and PageLink together |

Normal authoring MUST NOT persist unresolved PageLinks. If Page creation fails,
link creation also fails. Renaming a target Page updates displayed link text as
appropriate while preserving the target Page ID.

## 9. Trash and deletion

Normal deletion and permanent deletion are distinct Operations.

### 9.1 Move to Trash

Moving an Active Page to Trash MUST atomically:

1. preserve the Page ID, Blocks, title reservation, and Page history;
2. set the Page state to Trash;
3. convert every incoming PageLink to ordinary text containing the Page's current
   title; and
4. remove the Page and those converted links from the active Knowledge graph.

Existing backlinks therefore do not prevent ordinary deletion. Text produced by
link conversion is never silently converted back into a PageLink.

Creating or selecting a PageLink with the title of a trashed Page restores that
Page and creates the newly requested PageLink. Earlier converted text remains
plain text. Because Trash reserves the normalized title, a second Page with that
title cannot be created in the same Project.

### 9.2 Restore

An explicit restore returns the existing Page identity, Blocks, and retained
history to Active state. It does not reconstruct earlier incoming PageLinks.

### 9.3 Permanent deletion

The Owner may permanently delete an Active or Trash Page. The Operation MUST:

1. convert any remaining incoming PageLinks to ordinary current-title text;
2. permanently remove the Page, Blocks, Page history, and Page-owned records;
3. remove unreferenced Page-owned resources according to resource retention
   policy; and
4. release the normalized title for reuse.

Permanent deletion is not an Undo target. Editor permission to use Trash does not
imply permission to purge it.

## 10. Search and retrieval

The initial search projection is local and derived from Block text, Page titles,
Tags, PageLinks, and backlinks. Retrieval combines lexical full-text matching with
Tag, graph, Project, and Page-state filters. Embeddings MAY later implement the
same result contract but are not an initial default.

Search scope behaves as follows:

- default: Active Pages in the current Project;
- optional: explicitly selected authorized Projects;
- optional: all Projects the caller is authorized to read;
- optional: Trash in the selected Project set.

`all` MUST expand to authorized Projects rather than bypass authorization. An
Unavailable Project is reported as unavailable and contributes no cached result.

Each result returns a bounded excerpt plus Project ID, Page ID, Block ID, Page and
Block revision, Page state, and match reason. Reading additional content requires
a separate authorized read Operation. This contract gives Agents stable evidence
without sending entire Projects to a provider.

## 11. Agent changes, confirmation, and grants

### 11.1 Default behavior

At the default Review Confirmation level, an Agent creates a Change proposal for
knowledge changes. A proposal has no effect on Pages or Blocks until a User
reviews and applies it. Proposal application uses the recorded base revisions;
stale proposals become conflicts rather than overwriting newer edits.

### 11.2 Confirmation levels

The User profile stores one cumulative Confirmation level on the current device:

| Level | Unattended Agent behavior |
| --- | --- |
| Review | Authorized reads and creation of non-effective Change proposals |
| Recoverable | Review behavior plus authorized Recoverable Operations |
| Autonomous | Recoverable behavior plus authorized destructive and external Operations |

The setting survives chats, sessions, and App restarts. A new device starts at
Review. The User can change it immediately during a chat; the next authorization
uses the new value. An Agent cannot change its own level.

### 11.3 Independent authorization checks

Before invoking a handler, the Host MUST enforce all of the following:

1. declared caller type;
2. User and Project identity;
3. Project role;
4. Operation grant;
5. App-declared data and input constraints;
6. Confirmation class against the current profile level; and
7. `always-confirm`, when declared.

Failure of any check denies or prompts for that invocation; a higher Confirmation
level never broadens a role, grant, Project set, input allowlist, or data scope.
New or materially changed Operations do not inherit an earlier grant.

### 11.4 Initial Operation catalog

The table defines the required baseline classification and allowed caller types.
Every non-User caller additionally needs an Operation grant. The App may raise an
Operation to `always-confirm`, but configuration MUST NOT lower its declared
class. User UI calls remain subject to role checks even when a per-invocation Agent
prompt is not applicable.

| Operation | Effect | Minimum Project role | Confirmation class | Callers | Notes |
| --- | --- | --- | --- | --- | --- |
| `knowledge.project.list` | read | Viewer | Review | user, agent, flow, app | Returns only authorized catalog entries |
| `knowledge.project.create` | write | — | always-confirm | user, agent | Initiator becomes Owner; destination selection is explicit |
| `knowledge.project.duplicate` | write | Owner of source | always-confirm | user, agent | Creates a new unshared Project at an explicit destination |
| `knowledge.project.reconnect` | external | Owner | always-confirm | user | Validates a User-selected Project store |
| `knowledge.project.delete` | destructive | Owner | Autonomous | user, agent | Permanent Project deletion; no Editor access |
| `knowledge.page.list` | read | Viewer | Review | user, agent, flow, app | Project and Page-state scoped |
| `knowledge.page.read` | read | Viewer | Review | user, agent, flow, app | Supports bounded Block selection |
| `knowledge.page.search` | read | Viewer | Review | user, agent, flow, app | Scope rules in section 10 apply |
| `knowledge.page.backlinks` | read | Viewer | Review | user, agent, flow, app | Active graph by default |
| `knowledge.page.history.read` | read | Viewer | Review | user, agent, flow, app | Within the 30-day retention period |
| `knowledge.page.create` | write | Editor | Recoverable | user, agent, flow, app | Undo moves the Page to Trash |
| `knowledge.page.update` | write | Editor | Recoverable | user, agent, flow, app | Requires expected revision and inverse data |
| `knowledge.page.move-to-trash` | write | Editor | Recoverable | user, agent, flow, app | Includes incoming-link conversion |
| `knowledge.page.restore` | write | Editor | Recoverable | user, agent, flow, app | Does not reconstruct converted links |
| `knowledge.page.history.restore` | write | Editor | Recoverable | user, agent, flow, app | Creates a new revision |
| `knowledge.page.purge` | destructive | Owner | Autonomous | user, agent | Active or Trash; releases title |
| `knowledge.tag.create` | write | Editor | Recoverable | user, agent, flow, app | Project-local |
| `knowledge.tag.update` | write | Editor | Recoverable | user, agent, flow, app | Includes Page assignments |
| `knowledge.tag.delete` | write | Editor | Recoverable | user, agent, flow, app | Must retain inverse data during recovery |
| `knowledge.change-proposal.create` | write | Editor | Review | user, agent | Does not mutate target content |
| `knowledge.change-proposal.apply` | write | Editor | Recoverable | user | Revalidates role and base revisions |
| `knowledge.change-proposal.reject` | write | Editor | Review | user | Changes proposal state only |
| `knowledge.obsidian.import-preview` | external | Viewer | always-confirm | user, agent | Reads an explicitly selected Vault and changes nothing |
| `knowledge.obsidian.import-propose` | write | Editor | Review | user, agent | Produces additions and updates only |
| `knowledge.obsidian.export` | external | Viewer | always-confirm | user, agent | Writes to an explicitly selected destination |

Future membership invitation, role change, member removal, ownership transfer,
cloud connection, and cross-Project Page movement Operations MUST be individually
declared and `always-confirm` by default because they change external access or
sharing boundaries.

Every invocation records actor, Operation, effect, Confirmation class, matched
policy, timestamp, correlation ID, duration, and outcome without storing raw Page
content in the Host audit log.

## 12. Project storage

### 12.1 Common and Project-specific state

The Workspace stores App-common state under `apps/knowledge/`, including the
Project catalog, App settings, and non-content device metadata. It MUST NOT contain
a second authoritative Page copy or a searchable Page-content cache.

Each Project uses one User-selected Project store containing its authoritative
Pages, Blocks, Tags, PageLinks, Page history, resources, App-private SQLite
database, and local full-text index. The Host exposes it through a Project-scoped
storage port. The App does not receive an unrestricted filesystem path.

### 12.2 Project store manifest

Each Project store contains a small Host-managed manifest with:

- immutable Project ID;
- owning App ID;
- storage schema version;
- creation metadata;
- completed and pending migration metadata; and
- relative layout version.

The manifest contains no credentials or provider secrets. The Host validates it
before granting the storage port. Directory names and paths are location hints,
not Project identity.

### 12.3 Availability and reconnection

If the cataloged store is missing or invalid, the catalog retains an Unavailable
Project entry. Reads, search, and writes return an actionable unavailable result.
The Host MUST NOT silently create an empty replacement, serve stale content from
App-common storage, or treat the missing Project as deleted. A User may reconnect
it by selecting a store with the same valid Project identity.

### 12.4 Copies and explicit duplication

A filesystem copy retains the same manifest and is another location of the same
Project. If the original is unavailable, the copy may be used to reconnect it. If
the original is available, the Host rejects attaching the copy as an independent
Project.

`knowledge.project.duplicate` creates an independent Project by assigning a new
Project ID and new Page and Block IDs and rewriting internal PageLinks. It copies
only Active Pages, Blocks, Tags, PageLinks, and resources referenced by that
active state. It excludes Trash, Page history, membership and permissions, cloud
configuration, and device metadata. The new Project is local, unshared, and owned
by the initiating User. Source titles may be preserved because uniqueness is
Project-scoped.

### 12.5 Cloud and backup boundary

A cloud or future multi-user adapter exchanges versioned Project changes through
Host and App contracts. It never exposes the App-private SQLite file as a shared
database. A generic synchronized folder is supported only as a single-writer
backup location until a concurrency-safe adapter exists.

## 13. Obsidian interchange

One MyBox Project maps to one Obsidian-compatible Vault. Export defaults to Active
Pages; Trash is included only by explicit selection. A multi-Project Workspace is
never exported as one Vault.

### 13.1 Export

- A Page SHOULD use `<title>.md` when the title is a safe filename.
- When the title is not representable or collides under destination filesystem
  rules, export uses a deterministic ID-suffixed filename and a wiki-link alias so
  the visible title remains unchanged.
- PageLinks serialize as Obsidian wiki links.
- Tags serialize in YAML frontmatter.
- Blocks serialize in Page order as Markdown-compatible structures.
- Reserved frontmatter stores MyBox Page ID, Project ID, base revision, display
  title, and interchange schema version.
- Unsupported future Block details MUST produce a visible loss warning rather
  than being silently discarded.

### 13.2 Re-import

Re-import is explicit and produces a Change proposal. Existing Pages match by
reserved MyBox Page ID, never by title alone. A Page unchanged since the exported
base revision may accept the reviewed difference. If both MyBox and the Vault
changed, the proposal reports a conflict. New files propose new Pages.

A missing Vault file never proposes Page deletion. It may represent a partial
copy, rename, or external sync failure. Re-import proposes additions and updates
only; deletion remains an explicit MyBox Operation or a future explicit deletion
marker.

## 14. Future real-time collaboration contract

Real-time simultaneous editing is the target, but the initial release is local
and single-writer. Initial implementation MUST therefore:

- preserve stable Project, Page, and Block IDs;
- avoid whole-Page replacement as the only mutation mechanism;
- express edits as versioned Operations with expected revisions;
- detect conflicts rather than use last-write-wins silently; and
- keep cloud synchronization behind an adapter contract.

A later ADR must choose user identity, synchronization provider, offline merge,
CRDT or equivalent algorithm, presence protocol, revocation behavior, encrypted
transport/storage, and shared-history retention before real-time collaboration is
implemented.

## 15. Required user surfaces

The initial desktop UI MUST provide:

- current Project selection and clear Unavailable state;
- Page discovery without a Page hierarchy;
- Tag filtering;
- default current-Project search plus explicit selected/all Project and Trash
  scope controls;
- the Block editor and `[[...]]` Page picker;
- backlinks;
- Trash, restore, and Owner-only permanent deletion;
- Page history and restore;
- Change proposal review with visible target revisions and conflicts;
- visible current Confirmation level with immediate User-controlled switching;
- Project-role and denial explanations that distinguish role, grant, constraint,
  and confirmation failures; and
- explicit Obsidian import preview and export surfaces.

All surfaces follow [FRONTEND.md](../FRONTEND.md): MyBox dark appearance, semantic
controls, visible focus, full keyboard behavior, accessible names, state-complete
interactions, themed popups and scrollbars, responsive Windows scaling, and no
uncontrolled OS/browser default drawing.

## 16. Events

The App SHOULD publish versioned events after committed facts, including:

- Project created, duplicated, availability changed, and deleted;
- Page created, changed, moved to Trash, restored, and permanently deleted;
- Tag changed;
- Change proposal created, applied, rejected, and conflicted; and
- Obsidian import proposal created and export completed.

Event payloads contain stable identities, revisions, actor identity, and state
transitions needed by subscribers. They SHOULD NOT contain full Page bodies.
Subscriber failure never rolls back the committed App Operation.

## 17. Acceptance criteria

An initial implementation is conformant when automated tests and desktop checks
demonstrate at least the following scenarios:

1. Width-, case-, or surrounding-whitespace-equivalent Page titles cannot coexist
   in one Project, including Trash, but can coexist across Projects.
2. Markdown prefixes convert into the required Block types and Undo restores the
   original typed marker.
3. Renaming a Page preserves PageLinks through stable identity.
4. Moving a linked Page to Trash converts all incoming links to text, retains the
   Page and title, and excludes it from default search.
5. Selecting that Trash title through `[[...]]` restores the Page and creates only
   the newly requested PageLink.
6. Permanent deletion works from Active or Trash only for an Owner, removes
   history, converts remaining links, and releases the title.
7. Viewer, Editor, and Owner authorization remains unchanged when Confirmation
   level changes.
8. Review mode lets an Agent create a proposal but not mutate target Blocks
   without review; Recoverable and Autonomous behavior follows the Operation
   catalog and grants.
9. Stale Page or Block revisions produce conflicts and never overwrite newer
   edits.
10. Search defaults to Active Pages in the current Project and includes other
    Projects or Trash only when explicitly requested and authorized.
11. Removing a Project store makes the Project Unavailable without recreating or
    serving cached content; reconnecting the same manifest restores access.
12. A copied store cannot be attached as an independent Project, while explicit
    duplication generates new identities and excludes Trash, history, sharing,
    and cloud settings.
13. Obsidian re-import matches by Page ID, proposes changes, surfaces revision
    conflicts, and never treats a missing file as deletion.
14. The affected UI passes the interaction, accessibility, popup, dark-theme, and
    Windows scaling checks required by `FRONTEND.md`.

## 18. Delivery sequence

1. Extend the Host contract for Confirmation classes, Project roles, constrained
   grants, Project-scoped storage ports, and required audit fields.
2. Implement the Knowledge App domain model, SQLite persistence, migrations,
   title invariants, revisions, and lexical search projection.
3. Implement Page, Block, PageLink, Tag, Trash, history, proposal, and authorization
   Operations with focused domain tests.
4. Build and verify the accessible Notion-style desktop editor and required user
   surfaces.
5. Add Agent retrieval/change-proposal flows and Obsidian import/export.
6. Design cloud sharing and real-time collaboration in separate ADRs before adding
   a synchronization provider or CRDT.
