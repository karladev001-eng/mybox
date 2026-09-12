# Architecture Decision Records

ADRs are numbered sequentially and remain in this directory after supersession.
Each change set creates a new ADR for a new decision or updates the implementation
notes of the ADR it realizes.

## Index

- [0001 — Use operations and events for app collaboration](0001-operations-and-events.md)
- [0002 — Use a local-first Tauri workspace](0002-local-first-tauri-workspace.md)
- [0003 — Require scoped authorization and audit for non-user callers](0003-agent-authorization-and-audit.md)
- [0004 — Keep the initial GitHub repository private](0004-private-github-repository.md) (superseded by 0021)
- [0005 — Isolate agent providers behind a capability contract](0005-agent-provider-boundary.md)
- [0006 — Keep provider secrets in native credential storage](0006-store-provider-secrets-in-the-native-host.md)
- [0007 — Own provider-neutral chat history locally](0007-own-provider-neutral-chat-history-locally.md)
- [0008 — Expose Web search as a constrained provider capability](0008-expose-web-search-as-a-constrained-provider-capability.md)
- [0009 — Expose explicit skills and generated media](0009-expose-explicit-skills-and-generated-media.md)
- [0010 — Discover chat commands, models, and usage](0010-discover-chat-commands-models-and-usage.md)
- [0011 — Own the appearance of desktop controls](0011-own-the-appearance-of-desktop-controls.md)
- [0012 — Own a block-based knowledge graph in MyBox](0012-own-the-knowledge-graph-in-mybox.md)
- [0013 — Use Projects as exclusive Page sharing boundaries](0013-use-projects-as-exclusive-page-sharing-boundaries.md)
- [0014 — Search authorized Blocks locally before embeddings](0014-search-authorized-blocks-locally-before-embeddings.md)
- [0015 — Prepare Blocks for future realtime collaboration](0015-prepare-blocks-for-future-realtime-collaboration.md)
- [0016 — Separate profile Confirmation levels from Operation grants](0016-separate-profile-confirmation-levels-from-operation-grants.md)
- [0017 — Split App state from User-selected Project stores](0017-split-app-state-from-user-selected-project-stores.md)
- [0018 — Register installable App surfaces through a Host catalog](0018-register-installable-app-surfaces.md)
- [0019 — Provide a Host-owned contextual assistant panel](0019-host-contextual-assistant-panel.md)
- [0020 — Track installed App versions and apply catalog updates through the Host](0020-track-installed-app-versions-and-host-updates.md)
- [0021 — Publish signed desktop releases and update MyBox in place](0021-publish-signed-desktop-releases.md)
- [0022 — Identify Users through OAuth providers without holding passwords](0022-account-identity-through-oauth.md)
- [0023 — Merge shared Projects with Yjs over a sync server each group runs](0023-user-operated-sync-servers-with-yjs.md)
- [0024 — Deploy the sync server through the Cloudflare API instead of a GitHub-connected button](0024-deploy-the-sync-server-through-the-cloudflare-api.md)
- [0025 — Let the assistant panel invoke App Operations, gated by Confirmation level](0025-agent-operations-from-the-assistant-panel.md)
- [0026 — Embed images and URLs in Knowledge Blocks through opaque resource IDs](0026-embed-images-and-urls-in-knowledge-blocks.md)
- [0027 — Provide discoverable Host keyboard shortcuts](0027-host-keyboard-shortcuts.md)
- [0028 — Show the active Agent provider identity without storing credentials](0028-show-active-agent-provider-identity.md)
- [0029 — Restore the last working surface](0029-restore-the-last-working-surface.md)
- [0030 — Use Space-delimited live Tag entry](0030-use-space-delimited-live-tag-entry.md)
- [0031 — Indent Note text with Tab](0031-indent-note-text-with-tab.md)
- [0032 — Identify shared edits with Project member colors](0032-identify-shared-edits-with-member-colors.md)
- [0033 — Keyboard-navigate Note Page search results](0033-keyboard-navigate-note-page-search-results.md)
- [0034 — Split pasted Markdown into Note Blocks](0034-split-pasted-markdown-into-note-blocks.md)
- [0035 — Share App runtime and connect typed App resources](0035-share-app-runtime-and-connect-app-resources.md)
- [0036 — Browse Image templates as visual products](0036-browse-image-templates-as-visual-products.md)
- [0037 — Edit and import the final Image Prompt](0037-edit-and-import-the-final-image-prompt.md)
- [0038 — Run App automation as durable Workflows](0038-run-app-automation-as-durable-workflows.md)
- [0039 — Use one JSON document as the Workflow data plane](0039-use-one-json-document-as-workflow-data-plane.md)
- [0040 — Store Note Projects in User-selected directories](0040-store-note-projects-in-user-selected-directories.md)
- [0041 — Restore each App's last stable content position](0041-restore-each-apps-last-stable-content-position.md)
- [0042 — Select and undo Note Blocks as structural edits](0042-select-and-undo-note-blocks.md)

- [0043 — Make Knowledge the mandatory record foundation](0043-record-centered-knowledge-workspace.md)
- [0044 — Collect Context in a private Record Project](0044-collect-context-in-private-record-project.md)
- [0045 — Render chat Markdown with quiet actions](0045-render-chat-markdown-with-quiet-actions.md)

- [0046 — Link record Pages automatically](0046-link-record-pages-automatically.md)

- [0047 — Organize Pages and preserve File originals](0047-organize-pages-and-preserve-file-originals.md)

- [0048 — Search-first navigation and inline files](0048-search-first-navigation-and-inline-files.md)

- [0049 — Record-centered home](0049-record-centered-home.md)

- [0050 — Switchable workspace themes](0050-switchable-workspace-themes.md)

- [0051 — Unify Prompts and image generation records](0051-unify-prompts-and-image-records.md)

- [0052 — Explore record links as a graph](0052-explore-record-links-as-a-graph.md)

- [0053 — Show the whole workspace graph](0053-show-the-whole-workspace-graph.md)

- [0054 — Group and drag the side graph](0054-group-and-drag-the-side-graph.md)

- [0055 — Bound Project read and replay work](0055-bound-project-read-and-replay-work.md)

- [0056 — Preserve editor intent across async work](0056-preserve-editor-intent-across-async-work.md)
