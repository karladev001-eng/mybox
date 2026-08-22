# ADR 0038: Run App automation as durable Workflows

- Status: Accepted
- Date: 2026-08-22

The original no-mapping and summary-only Command result decisions are extended
by [ADR 0039](0039-use-one-json-document-as-workflow-data-plane.md), which adds a
bounded Workflow JSON document and restricted field mappings.

## Context

ADR 0035 introduced typed Connector pairs, but a Connection can perform only one
pull or one Event-to-consume delivery. It has no ordered steps, durable queue,
schedule, run history, or crash-resume boundary. Adding those behaviors directly
to every App pair would duplicate authorization and create privileged integration
paths outside normal Operations.

## Decision

The Host owns versioned Workflow definitions and durable Runs. A Workflow begins
with an App Event, a User action, an hourly/daily/weekly wall-clock schedule, or
an App request, then invokes an ordered list of Workflow Actions. App-declared
Actions name normal public Operations and declare optional typed input and output.
The whole typed item passes between adjacent Actions; v1 has no field mapping,
expressions, branching, loops, or parallel steps.

The Host also projects each non-destructive Operation exposed to both `agent` and
`flow` as a Workflow Command unless an explicit Action or consume Connector
already represents that Operation. A Command uses the Operation input Schema as
its static configuration, invokes that Operation directly, and passes the prior
typed item through unchanged. Its untyped return value is not available to later
Steps and history stores only a small structural summary. Destructive Operations
remain outside automatic Workflow projection. An App opts an Operation out by
not exposing it to `flow`, without changing its Agent availability.

Each Workflow grants only the Operations named by its Steps. The caller remains
the existing serialized `flow` actor, so App caller declarations remain
compatible. Confirmation level, fresh approval, always-confirm, App removal,
resource grants, and audit logging stay enforced by `AppHost`. A Run that needs
approval or fails stops at the current Step and resumes with the same Run and
delivery IDs.

Every Event becomes a durable Run and Runs execute sequentially per Workflow.
Transient service, network, provider, and timeout failures retry after 5 seconds,
30 seconds, and 5 minutes; other failures do not retry automatically. On restart,
an interrupted typed Action is queued again with its stable delivery ID.
Consumers remain responsible for idempotency. A read-only Workflow Command may
also resume automatically. A write or external Command has no delivery parameter
in its original Agent API, so a crash after invocation leaves its outcome
uncertain: the Run stops for User review instead of risking an automatic
duplicate. Those Commands also do not receive automatic transient retries.
User-visible history keeps the newest 200 Runs per Workflow, visualizes each
Step's state, attempts, duration, and error, and stores Resource references rather
than image bytes or arbitrary Operation results.

Schedules use an IANA time zone and simple hourly, daily, or weekly fields. On
resume, only the newest missed wall-clock occurrence runs. Enabling the first
schedule offers optional operating-system startup. Background execution keeps
the Tauri process in the system Tray after its window closes; explicit exit is a
separate User action. Single-instance handling restores the existing window, and
failed or approval-waiting Runs send a notification when permission exists.

Existing push/consume Connections migrate to Event Workflows with one Action.
Pull/pull Connections migrate to App-request Workflows. Migration is deterministic
and recorded only after the Workflow file is written; the original Connection
file remains as a one-release compatibility backup. A failed or approval-waiting
legacy Event envelope becomes a paused Run and is deduplicated by its deterministic
Run ID. `ctx.connections.pull()` delegates to `ctx.workflows.request()` during
that period.

## Consequences

App automation is inspectable, resumable, and composable without giving one App
access to another App's state. Operations that Agents could already invoke become
searchable visual Commands without gaining a new execution path or broader
authority. Different Workflows may run independently, while one Workflow never
overlaps its own Runs. A schedule cannot bypass confirmation, so an always-confirm
Image reference upload pauses even in the background.

The Host now owns background lifecycle and schedule reconciliation. App manifests
gain `workflowActions`; Apps that expose a consume Connector need no duplicate
Action declaration unless they want a distinct title, output type, or metadata.

## Implementation notes

`core/workflow-manager.js` owns Workflow persistence, migration, typed validation,
Agent Operation projection, queueing, retries, schedules, and run history.
`WorkflowView.jsx` supplies the searchable horizontal editor, JSON Schema
configuration controls, and Step-level history. Image `0.5.0` publishes a
no-input generation Action and Note `0.3.0` publishes its idempotent
generated-image Page Action and makes its always-confirm Project creation
Operation available to Flow as well as Agent callers.
Tauri's tray, autostart, notification, and single-instance facilities implement
the desktop lifecycle without exposing a new App data path. Selecting a desktop
notification restores the window and focuses the affected Run in real history.
