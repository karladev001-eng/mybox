# ADR 0016: Separate profile Confirmation levels from Operation grants

- Status: Accepted
- Date: 2026-08-16

## Context

Agents need one consistent autonomy control across Apps, while each App still
owns its commands, data boundaries, and domain-specific restrictions. A single
"full access" switch cannot express policies such as allowing email only to named
recipients, denying purchases, or requiring confirmation for a particular command
even at the highest Confirmation level.

## Decision

Each User profile persists one of three cumulative Confirmation levels. Review is
the default for a new profile and permits only Level 1 authorized Operations to
run unattended; other changes are proposed or confirmed. Recoverable additionally
permits Level 2 Recoverable Operations. Autonomous additionally permits authorized
Level 3 destructive and external Operations. The selected level changes prompt
behavior only and never grants an Operation or expands an App's data scope.

The level survives new chats, Agent Sessions, and App restarts. A User may change
it immediately, including during a chat, and the next Operation authorization uses
the new value. Every change is audited, and an Agent cannot change its own level.
The initial implementation stores the level per User profile on the current device
and does not synchronize it. Signing in on a new device starts that device at
Review even when the same User profile is used elsewhere.

Every Operation declares a Confirmation class of Review, Recoverable, Autonomous,
or always-confirm in addition to its effect and allowed callers. An App may
therefore make an Operation non-bypassable at every Confirmation level. An
invocation runs without a prompt only when its Confirmation class is at or below
the User profile's level, its caller and Operation grants are present, and every
App-declared data and input constraint passes.

The Recoverable class is limited to Recoverable Operations. Such an Operation has
no external effect, retains the state or inverse data needed to reverse the change,
declares a recovery period, and provides an Undo Operation that passes through
normal Host authorization and audit. A write that cannot satisfy all of these
requirements is Autonomous or always-confirm even when its primary data remains
in local storage.

External Operations are managed per App and Operation. Grants may constrain
inputs such as allowed email recipients, while an unrelated Operation such as a
purchase remains ungranted or always-confirm. New or changed Operations never
inherit an earlier grant automatically. The Host enforces the combined policy and
audits the selected level, matched grant, constraints, actor, and outcome without
logging raw payloads.

Apps declare the configurable constraint fields and their validation contracts;
user selections produce declarative input constraints that the Host can evaluate
before invoking the handler. App-provided labels or controls may help configure a
grant, but authorization cannot depend only on App handler code. The Host remains
the final enforcement point for data scope and constrained input values.

## Consequences

Users can persist and change autonomy consistently across Apps without turning the
setting into unbounded access. App manifests and Host authorization must evolve
beyond the current effect-only contract, and the permission UI must explain both
the profile level and the narrower grants that still apply.

## Implementation notes

As of 2026-08-16, manifests declare and validate the four Confirmation classes,
the Host evaluates Agent invocations against the three cumulative levels and
fresh approval, and audit records include the selected level and Operation class.
The selected level is immediately switchable and is stored in the current
device's host-profile namespace across restarts.

As of 2026-08-18, that switch lives in the Host's assistant composer
(`ChatView.jsx`'s footer, beside the model and Thinking pickers) rather than in
the Knowledge editor's sidebar, and `App.jsx` owns the loaded preferences. The
level was always device-wide, but hosting its only control inside one App
implied it governed that App alone — misleading once
[ADR 0025](0025-agent-operations-from-the-assistant-panel.md) made every
registered App's Operations invocable from the assistant regardless of which
App is open. It now sits next to the composer it actually governs, and
`knowledge/client.js` no longer reaches the Host profile store at all.

The current grant model still matches whole Operation IDs only. Declarative input
constraints, grant-management UI, per-change audit for the profile setting, and
recovery-period/Undo metadata enforcement are pending. User-initiated UI actions
remain directly authorized domain actions; destructive permanent deletion has a
separate explicit confirmation dialog.
