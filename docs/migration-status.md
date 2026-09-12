# Record migration status

This is the implementation and rollout checklist for ADRs 0040, 0043, 0044,
0048, 0049 and 0051–0054, not a new architecture decision. Last reviewed:
2026-09-12. Deployment and real-data results are independent of code completion.

## Release candidate

- Host: 0.10.0; Knowledge: 1.26.6; Image: 0.6.1.
- Knowledge schema/native manifest: 5. Sync record protocol: 4.
- Real-provider image generation: user confirmed success on 2026-09-12.
- Signed desktop artifact: tracked by the tag-triggered release workflow.
- Workspace-specific migration and endpoint rollout results are maintained privately.
  This public checklist does not contain instance-level record counts or configuration.
- Native pointer-state, IME/DPI and dense real-workspace graph checks: not verified.

## Implemented migrations

| Source | Destination and trigger | Completion condition |
| --- | --- | --- |
| Common Knowledge JSON and old ID-named stores | Project-named append-only Yjs stores when stores are listed | Current Pages including Trash and resources retained, catalog switched after copy |
| Legacy ai-chat history | Conversation Pages when the Host conversation store loads | Session/message metadata and media verified; migration phase complete |
| Per-turn Context | Linked legacy records alongside conversation Context notebooks | Old inputs retained; subsequent turns use notebooks |
| Former Folders | Ordinary Notes with child PageLinks through library flatten Operation | IDs/content retained, parent assignments cleared; no Viewer writes |
| Image templates/history | Prompt/Generation Pages and Project Files when Image records load | Raw backup and durable mappings retained; records and bytes verified before marker |
| Workflow destinations | Home on restore; desktop execution disabled | Definitions/history retained; no automatic Workflow start |

Owner backups and provider caches are intentional retained data, not another
record authority. Removing them is not a migration acceptance criterion.

## Rollout order

1. Run core, native and local sync tests; build the frontend and embedded server.
2. Commit the intended source/docs only. Align package, native configuration and
   Rust crate versions, then push the matching release tag.
3. Verify CI succeeds and the draft contains signed Windows installers and an
   updater manifest. Publish the reviewed release through the existing release
   process (ADR 0021); a draft alone delivers no update.
4. Update the selected group endpoint with the bundled protocol-4 server before
   reconnecting shared clients. All collaborating clients must use a compatible
   version; protocol 4 rejects older clients. Preserve endpoint identity, server
   secret and existing Durable Object data. Do not create a replacement endpoint
   or deploy an arbitrary local Worker as a substitute.
5. Verify migration against a copy of the selected workspace, then confirm the
   production workspace's migration status through its normal Host startup.

## Existing-data verification

Close the source application before copying its workspace and external Project
stores. Keep the copy outside version control, preserve identities, and do not
connect it to a production sync endpoint. Never publish record text, images,
account identities, tokens or local paths in a migration report.

- Inventory source counts/IDs by record kind and state, including Trash and image
  references. Record only aggregate results in the repository.
- Open the copy through the normal Host, then load conversations and Image.
  Verify checkpoint completion, stable ID mappings, record counts and media hashes.
- Restart and verify no duplicate records, title collisions or repeated imports.
- Create new records in the copy and verify Knowledge is the only new record
  destination; legacy content remains backup/marker data.
- Exercise an interrupted migration and missing-media retry on disposable copies.
  The missing-media attempt must remain incomplete and preserve source data;
  restoring the original must resume with the same mappings.
- Confirm old Context links, File reads and Folder conversion; exercise Owner,
  Editor and Viewer behavior on isolated test Projects.

Automated fixture tests cover these invariants but do not certify a particular
user workspace. Do not infer successful migration from a successful generation.

## Deferred work

PDF text/OCR indexing, Chunks/semantic retrieval, Obsidian exchange, richer
proposal/grant support, safe log compaction and original-resource cleanup are
separate extensions. Folder restoration and Workflow reactivation are not
required by the accepted record-workspace direction.


## Automated verification — 2026-09-12

214 core tests, 4 Sites packaging tests, 16 sync unit tests, 19 local server
integration checks, 7 live client checks and 37 native Rust tests passed. The
7 pre-existing authenticated provider tests remain ignored; real image generation
was separately confirmed by the user. Frontend/package and embedded sync-server
builds passed. Vite reports the existing large-chunk warning.
