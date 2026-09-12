# 0055 — Bound Project read and replay work

Status: Accepted

## Context

Aggregate record Operations used the editor Page reader for every live Page.
That reader derives backlinks and tag counts by scanning the entire Project,
making an aggregate projection quadratic in Page count. Store replay also
notified subscribers once per historical update.

## Decision

Expose an internal session bulk record snapshot for Knowledge Operations. Read
Page bodies once and reuse them for tag counts; retain the editor reader for
individual Pages that need backlinks. Host authorization and live membership
overlays remain mandatory. Returned records are detached values, not a cache.

Apply each Project-store pull in one Yjs transaction with the existing remote
origin. Persist local updates as before; successful update IDs remain tracked
and pulled updates must never echo back to the store.

Index previous Pages by ID when comparing record mutations instead of repeatedly
searching the complete array. Do not change persistence formats or discard logs.

## Verification

Regression tests cover bulk projection equivalence, detached records, revoked
membership, replay notifications and continued persistence after replay. A
synthetic 300-Page projection compares the previous and new paths.

Implementation validation: 219 core tests and 4 packaging tests pass; the package
build passes with the existing large-chunk warning. In a local synthetic
300-Page comparison (five runs per path), median aggregate projection time
was 65.81 ms through the legacy reader and 0.99 ms through the bulk reader.
This measures only projection CPU time, not end-to-end desktop startup or
provider generation latency. Replaying 100 updates emits one document update.

Remaining profiling candidates are initial bundle loading, graph layout with
large Projects, media decoding, and native filesystem I/O. Desktop interaction
latency has not been measured in this change; no UI behavior is changed.
