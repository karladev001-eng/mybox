# 0056 — Preserve editor intent across async work

Status: Accepted

## Decision

Queued edits retain the Page and mutation selected when the edit was submitted.
Serialize their revisions and count all outstanding writes for saving feedback.
Apply acknowledged Page content immediately; refresh derived lists separately.
A failed write must not be labelled saved. Do not make optimistic durable claims.

Only the newest Page read may change the selected Page, including after a
Project change. Ignore obsolete read errors. Invalidate search results before
the debounce delay and do not repeat the same Page listing for an empty query.
Refresh events must not restore the Page that was selected before a new click.

## Verification

Use delayed promises to cover switched Pages, revision ordering, failure recovery,
pending counts, and stale-request guards. UI verification limitations are recorded
with the implementation results.

Keep the local Block draft visible across blur and delayed acknowledgements.
A failed draft remains available to edit and resubmit while the Block is mounted.
Track failed edit targets separately so a different successful edit does not
falsely clear the failure indicator. Show a loading state during Page selection.

Keep image-reader callback identities stable so unrelated editor renders do not
reread embedded originals. Live Project refreshes reuse the scoped search loader
instead of replacing search results with an unfiltered Page list.

Block drafts report their unsaved state before blur so the header does not claim
that text still being edited has already been persisted.

Validation: 224 core tests pass, including five delayed-operation regressions.
The package builds with the existing large-chunk warning. Native and browser
UI automation failed to initialize in the local sandbox; dark/light desktop
interaction, IME, focus and scaling checks remain unverified. No provider call
or production data mutation was used for this verification.

Browser interaction verification found that narrow layouts hid all save feedback.
Below 1300px, display the same save state in Page metadata. The isolated
interaction preview provides controlled write latency and failures for UI QA.


Browser verification completed after automation became available:
- Create A, edit its body, create B while leaving the editor, edit B and search
  back to A: both Pages retain their respective bodies.
- With a 1500 ms simulated write delay, unsaved, saving and saved states appear
  in order and the new text remains visible after blur.
- Simulated write failure retains the draft and failure status; disabling the
  fault and resubmitting saves that same draft successfully.
- Title Enter moves to Tags, Tags Enter opens the body, and Escape closes the
  Project menu and restores focus to its trigger.
- Light and Graphite render correctly at 1440 and 720 CSS pixels; document
  scroll width equals viewport width. Exactly one save indicator is visible.
- Renaming a Page updates the graph label without pressing Refresh.

These are real browser interactions with the actual Knowledge component and
Host Operations in the isolated fixture. They do not validate native disk I/O,
Windows IME composition, physical display scaling, or provider generation.
