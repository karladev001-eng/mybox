# ADR 0039: Use one JSON document as the Workflow data plane

- Status: Accepted
- Date: 2026-08-22

## Context

ADR 0038 made Agent Operations visible as Workflow Commands, but Commands kept
only static input and discarded their return values after producing a summary.
That made the automation visible without making it composable: for example, a
Page-list Command could run, but a later Step could not use the returned Page
titles. Persisting inputs and outputs in separate Step files would also make one
Run difficult to inspect and would create ambiguous recovery boundaries.

## Decision

The Host owns one versioned JSON document for each Workflow. Its `data` object is
the User-editable shared working area. Its reserved `runs` object records the
Trigger and the resolved input, validated output, state, timestamps, and error of
every Step. A stable Run ID and Step ID address every record. The newest 50 Runs
are retained in the document, which is limited to 4 MiB. Resource references stay
as JSON metadata; binary resource bytes never enter the document.

A Step may declare ordered JSON-path mappings. An input mapping reads a value
from the Workflow document and writes it into the Operation input before normal
schema validation. An output mapping reads from the validated Operation result
and writes only below `$.data` in the Workflow document. Static configuration is
the fallback for fields without an input mapping. The Host persists the resolved
input before invocation and the output plus mappings before advancing to the next
Step.

The path language is intentionally smaller than JSONPath: `$`, dot properties,
numeric array indexes, and read-only array wildcards such as
`$.pages[*].title`. It has no filters, expressions, recursive descent, script
evaluation, or wildcard destinations. Prototype keys are rejected. A missing or
invalid path stops the Step with an actionable error instead of producing an
implicit `null`.

Operation output schemas are part of the visual Command contract. Apps should
describe useful result fields rather than publishing only `{type: "object"}`.
The Workflow editor derives selectable result paths from that schema, while still
allowing a valid path to be entered directly.

## Consequences

A Workflow can visibly express “read `$.data.projectId` as this command's
`projectId`, then write `$.pages[*].title` to `$.data.pageTitles`.” The same JSON
document provides a local audit of actual data movement and a durable input for a
later Run. It does not broaden the Workflow grant, caller type, Confirmation
level, Project role, or App storage access.

Recording complete JSON results consumes more local space and may contain
sensitive App data. The document therefore remains in Host-owned local storage,
is bounded, is removed with its Workflow, and is not written to metadata-only
Host audit logs. Values too large for the bound stop the Workflow rather than
being silently truncated.

## Implementation notes

`core/workflow-json.js` owns the restricted path parser, safe reads and writes,
mapping application, document shape, retention, and size checks.
`core/workflow-manager.js` owns one `workflow-data/<workflow-id>.json` storage
record and updates it at each durable execution boundary. `WorkflowView.jsx`
edits initial `data`, shows the complete document, and derives mapping candidates
from Operation output schemas. Note `0.4.0` publishes concrete schemas for its
Project, Page, search, Markdown, and Tag read results.
