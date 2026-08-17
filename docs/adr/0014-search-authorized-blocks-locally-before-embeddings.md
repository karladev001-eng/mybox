# ADR 0014: Search authorized Blocks locally before embeddings

- Status: Accepted
- Date: 2026-08-15

## Context

Agents need focused evidence from Pages without receiving an entire workspace or
depending on one inference provider. Embedding search could improve paraphrase
matching, but it would introduce model lifecycle, reindexing, privacy, and shared
Project authorization decisions before the basic retrieval contract is proven.

## Decision

The knowledge App owns a local search projection derived from Block text, Page
titles, Tags, Page links, and backlinks. Initial retrieval combines local lexical
search with graph and metadata filters. Each result identifies its Project, Page,
Block, and revision and returns only a bounded excerpt; callers use a separate
authorized read Operation for additional content.

Every query carries a Search scope. It defaults to active Pages in the current
Project and may explicitly include selected authorized Projects, all authorized
Projects, or Trash. Search and follow-up reads validate Project access through the
Host. Embedding retrieval may later be added behind the same result contract, but
provider-hosted embeddings and transmission of Page content are not initial
defaults.

## Consequences

The first implementation remains local-first, deterministic, and provider-neutral
while still giving agents stable Block-level citations. Semantic similarity is
weaker until an embedding adapter is deliberately introduced.

## Implementation notes

As of 2026-08-16, `knowledge.page.search` performs deterministic local lexical
matching and returns Project, Page, Block, and revision identities with explicit
Project and Trash scopes. The vertical slice derives this projection in memory
from persisted JSON. SQLite FTS, bounded excerpt ranking, and Host-enforced
multi-Project scope grants remain pending with the Project-store work.
