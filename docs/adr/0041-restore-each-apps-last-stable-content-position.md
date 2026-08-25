# ADR 0041: Restore each App's last stable content position

- Status: Accepted
- Date: 2026-08-26

## Context

ADR 0029 lets the Host reopen Note or Image, but deliberately stops at the App
Surface boundary. Note then discarded its selected Project and Page, while
Image selected the newest visible generation rather than the image the User had
been viewing. Repeated App switching therefore lost the User's working context.

The Host must not inspect App-private navigation, and transient input must not
become an accidental session snapshot.

## Decision

Each App may persist an **App resume position** in its own namespaced storage.
The record is keyed by User profile and contains only stable content IDs. Note
stores its last Project and Page IDs; Image stores its last generation ID.
Draft text, search queries, filters, scroll positions, open panels, dialogs, and
pending actions are excluded.

The Surface reads and writes this record through User-only App Operations. On
open, it validates the saved IDs against content the current profile can still
access. A missing Project falls back to the first accessible Project with no
Page selected. A missing Image generation falls back to the newest visible
generation. A remembered Trash item reopens with Trash visible. Note prepares a
Project's runtime-owned shared session before validating a remembered Page so a
shared Page is not mistaken for deleted content.

## Consequences

Opening an App resumes the content the User was working with without expanding
the Host's authority or persisting sensitive drafts. Separate profile entries
prevent one local User from inheriting another User's position. Deleting or
losing access to remembered content cannot strand the Surface on an invalid ID.

## Implementation notes

Note `0.5.12` stores `projectId` and `pageId` in
`apps/knowledge/view-state.json`. Image `0.5.5` stores `generationId` in
`apps/image-studio/view-state.json`. Both files use schema version 1 and a
profile-keyed map. The Registry versions are Note `1.19.6` and Image `0.5.5`.
If an updated Surface is temporarily paired with an older live Host that has no
resume-position Operations, the clients use an empty position and continue
loading authoritative Projects or generation history. Other Operation failures
remain visible and are not downgraded.
