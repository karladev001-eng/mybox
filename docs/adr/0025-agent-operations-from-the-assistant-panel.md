# ADR 0025: Let the assistant panel invoke App Operations, gated by Confirmation level

- Status: Accepted
- Date: 2026-08-18

## Context

[ADR 0019](0019-host-contextual-assistant-panel.md) gave the assistant panel a
display-only label naming the current screen and explicitly deferred real
Operation access: "Agent work remains limited to Host-authorized public
Operations and existing provider capabilities... Future operation-aware
context [is] not decided here." A User who asks the assistant to edit the Page
they have open is told MyBox cannot do that — not because the framework lacks
the capability, but because nothing connects the chat panel to it.

The capability already exists in two disconnected pieces. `core/agent-runtime.js`
implements a working decision loop — it lists Operations an `agent` actor may
call, asks a provider to choose `respond` or `invoke`, and calls
`AppHost.invoke()` — but nothing in the app ever constructs or calls it;
`App.jsx`'s chat send path calls a provider's `generate()` directly for plain
text. Separately, `mybox-app/src/knowledge/client.js` constructs its own
private `AppHost` instance inside `createKnowledgeClient()`; no other module,
including the assistant panel, can reach it. And `knowledge.page.update` /
`knowledge.page.create` already declare `agent` among their callers with
`confirmationClass: "recoverable"` — the manifest side is ready and waiting.

## Decision

**A host-level registry makes each App's live `AppHost` reachable by
Operation ID's App prefix, independent of which View is mounted.** An App's
`client.js` registers the `AppHost` it already owns
(`registerAgentHost(appId, host)`); nothing else changes about how that
client is constructed. This is the App-agnostic seam: any future App that
wants assistant-driven Operations registers itself the same way. Only
Knowledge does today.

**The context an App surface reports grows from a display label into a
structured object carrying an App ID and an opaque operation context** (for
Knowledge: Project ID, Page ID, revision, and the open Page's Blocks). The
Host still never receives a raw storage path — everything here is IDs and
content already returned by the `knowledge.page.read` Operation the View
already called, not a new access path into App internals.

**A chat turn runs through `AgentRuntime` instead of a raw provider call
whenever any App has registered a host at all** — not only while that App's
own View is the one currently mounted. `createAggregateAgentHost()` unions
`listOperations()` across every registered host and routes `invoke()` to
the one that owns the called Operation, found from the ID's App-prefix
(`app-contract.js` already enforces `<appId>.<name>` namespacing at
registration, so this needs no separate bookkeeping). A User asking from the
Apps screen to create a Page works the same way as asking from inside an open
Page: the Operation was available either way. Uninstalling or never opening
an App keeps its Operations out of the list for free, since an App that
never mounted never registered a host — Operation count grows only with what
is actually installed and has run this session, not with everything MyBox
ships.

**An open record's structured context is additive, not a gate.** When a View
reports one (Knowledge: Project ID, Page ID, revision, open Blocks), it is
folded into the turn's goal so the model can act on that exact record instead
of searching for it. When none is open, the goal says so and the model is
expected to reach for a read Operation (list or search) to find what it needs
— the same Operation surface serves both cases. The turn falls back to
today's free-form `generate()` only when no App has registered a host at all
(nothing installed has opted in yet) or the User explicitly turned on image
generation for that message, which the decision loop cannot serve.

**`AgentRuntime` gates a write on the User's device-wide Confirmation level,
proactively rather than by catching a thrown authorization error.** Given
`confirmationLevel` and a new `onApprovalNeeded` callback, it compares each
chosen Operation's `confirmationClass` against that level *before* invoking
(`operationNeedsApproval`, a small pure helper `app-contract.js` now exports
so this mirrors `defaultAuthorize`'s existing comparison rather than
reimplementing it). When approval is needed, it awaits the callback with the
Operation's title, effect, and the exact input the model chose, so the panel
can show the User a real preview — not just "the AI wants to run
`knowledge.page.update`" — before the write happens. A denial is recorded as
an observation and the loop continues, so the model can adapt instead of the
turn hard-failing. This still relies on `AppHost.invoke`'s own authorization
as the actual enforcement boundary per
[ADR 0003](0003-agent-authorization-and-audit.md); the proactive check exists
so the panel can ask *before* attempting the call, not instead of the Host's
check.

**The grant is `{ operationIds: ["*"] }`, scoped by the fact that
`listOperations({ callerType: "agent" })` already only returns what that
App's manifest exposed to `agent` callers.** The Confirmation-level gate is
what actually protects a write, not the grant; a narrower per-call grant list
is not built here.

## Consequences

- A chat turn routed through the decision loop loses the rich free-form
  turn's skills and Web search for that turn regardless of whether it ends
  up invoking anything — `AgentRuntime` calls a provider with a decision
  schema, not the full generate contract those features are built on.
  Reconciling the two request shapes into one turn is not attempted here.
  Image generation is the one capability explicit enough as a per-turn
  toggle that the app checks it and keeps the free-form path instead.
- Every installed App's agent-eligible Operations are listed on every routed
  turn once any host is registered, whether or not the request needs them —
  the prompt grows with what is installed and has run this session, not with
  one App at a time. This is deliberately accepted over the narrower,
  View-scoped first cut: gating on "is this App's View open" made a Page's
  own Operations invisible from anywhere else in MyBox, which defeated the
  point of a host-mediated, App-agnostic surface.
- Only Knowledge registers a host today. Every other App still gets
  label-only context, unchanged from ADR 0019, until its own `client.js`
  registers one.
- A stale `expectedRevision` in the composed goal is possible under
  concurrent edits, same as any other caller of `knowledge.page.update`; the
  Operation already rejects it with `REVISION_CONFLICT` rather than
  corrupting state.
- `AgentRuntime.run()`'s new `onApprovalNeeded`/`confirmationLevel` options
  are additive and default to today's behavior (`confirmationLevel: "review"`,
  no callback — meaning anything above `review` is denied rather than
  silently approved), so the two existing tests in
  `mybox-app/tests/agent-runtime.test.mjs` are unaffected.
- `createAggregateAgentHost()` does not assume `actor.type` is `"agent"` —
  it only routes by Operation-ID App-prefix. A future Flow runtime
  (`docs/adr/0001-operations-and-events.md` already lists `flow` among an
  Operation's possible callers) can reuse it unchanged by passing
  `actor: { type: "flow", ... }` through `invoke`'s options, and can trigger
  on an App's Events through the same `host.subscribe()` every registered
  host already exposes. Building that runtime is not this ADR.

## Deferred

Reconciling `AgentRuntime`'s decision loop with the free-form chat turn's
skills and Web search, a real diff view for a proposed Block mutation rather
than a JSON preview, per-call grant scoping narrower than every registered
App's agent-eligible Operation list, trimming the Operation list by relevance
instead of listing every registered App's in full, a Flow runtime built on
`createAggregateAgentHost()`, and wiring any App besides Knowledge are not
decided here.

## Implementation notes

As of 2026-08-18: `mybox-app/src/core/agent-host-registry.js` holds the
`appId -> AppHost` map and exports `createAggregateAgentHost()`, which unions
`listOperations()` and routes `invoke()` by Operation-ID App-prefix.
`app-contract.js` exports `operationNeedsApproval`. `agent-runtime.js`'s
`run()` accepts `confirmationLevel` and `onApprovalNeeded`. `knowledge/client.js`
registers its host on construction. `KnowledgeView.jsx` reports
`{ label, appId, operationContext }` through `onContextChange` instead of a
bare string, `operationContext` only while a specific Page is open.
`App.jsx` routes a turn through `AgentRuntime` whenever
`hasRegisteredAgentHosts()` is true and image generation was not explicitly
requested for that turn, composes the goal from the current context (with or
without an open record), and renders an approval dialog backed by a Promise
the runtime awaits.
