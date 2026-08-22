import assert from "node:assert/strict";
import test from "node:test";
import { APP_SCHEMA_VERSION } from "../src/core/app-contract.js";
import { AppHost } from "../src/core/app-host.js";
import { createAppStorage, MemoryStorageDriver } from "../src/core/storage.js";
import { latestScheduleOccurrence, WorkflowManager } from "../src/core/workflow-manager.js";
import { readWorkflowJsonPath, writeWorkflowJsonPath, workflowSchemaPaths } from "../src/core/workflow-json.js";

const schema = { type: "object" };
const operation = (id, effect = "read", confirmationClass = "review") => ({ id, title: id, effect, confirmationClass, callers: ["user", "app", "flow"], inputSchema: schema, outputSchema: schema });
const agentOperation = (id, { effect = "read", confirmationClass = "review", callers = ["user", "agent", "flow"], inputSchema = schema, outputSchema = schema } = {}) => ({ id, title: id, effect, confirmationClass, callers, inputSchema, outputSchema });

test("reads array values and writes only explicit JSON paths", () => {
  const result = { pages: [{ title: "朝" }, { title: "夜" }] };
  assert.deepEqual(readWorkflowJsonPath(result, "$.pages[*].title"), ["朝", "夜"]);
  assert.deepEqual(writeWorkflowJsonPath({}, "$.data.pageTitles", ["朝", "夜"]), { data: { pageTitles: ["朝", "夜"] } });
  assert.throws(() => writeWorkflowJsonPath({}, "$.data[*]", [], { requireDataRoot: true }), /\[\*\]/);
  assert.throws(() => writeWorkflowJsonPath({}, "$.__proto__.polluted", true), /使用できない/);
  assert.deepEqual(workflowSchemaPaths({ type: "object", properties: { pages: { type: "array", items: { type: "object", properties: { title: { type: "string" } } } } } }), ["$.pages[*].title"]);
});

function sourceApp() {
  return {
    manifest: {
      schemaVersion: APP_SCHEMA_VERSION, id: "source", name: "Source", version: "1.0.0",
      operations: [operation("source.publish", "write", "recoverable"), operation("source.items.list")],
      events: [{ id: "source.done", title: "Done", payloadSchema: schema }],
      connectors: { sources: [
        { id: "source.done-items", title: "Done", mode: "push", dataType: "mybox.generated-image.v1", eventId: "source.done", configSchema: schema },
        { id: "source.items", title: "Items", mode: "pull", dataType: "mybox.prompt-fragment.v1", operationId: "source.items.list", configSchema: schema },
      ], targets: [] },
    },
    handlers: {
      "source.publish": async (input, { emit }) => { await emit("source.done", input); return {}; },
      "source.items.list": ({ config }) => ({ items: [{ id: "item", config }] }),
    },
  };
}

function targetApp({ consume }) {
  return {
    manifest: {
      schemaVersion: APP_SCHEMA_VERSION, id: "target", name: "Target", version: "1.0.0",
      operations: [operation("target.consume", "write", "recoverable"), operation("target.read")], events: [],
      connectors: { sources: [], targets: [
        { id: "target.consume-items", title: "Consume", mode: "consume", dataType: "mybox.generated-image.v1", operationId: "target.consume", configSchema: schema },
        { id: "target.library", title: "Library", mode: "pull", dataType: "mybox.prompt-fragment.v1", configSchema: schema },
      ] },
    },
    handlers: {
      "target.consume": consume,
      "target.read": async (_, context) => context.workflows.request("target.library"),
    },
  };
}

async function waitFor(manager, predicate, message = "Workflow did not reach the expected state") {
  for (let index = 0; index < 100; index += 1) {
    const value = predicate(manager);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(message);
}

function setup({ confirmationLevel = () => "review", consume = () => ({}) } = {}) {
  const driver = new MemoryStorageDriver();
  let manager;
  const host = new AppHost({ storageDriver: driver, workflows: { request: (...args) => manager.request(...args) } });
  host.register(sourceApp());
  host.register(targetApp({ consume }));
  manager = new WorkflowManager({ host, storage: createAppStorage("mybox-host", driver), confirmationLevel });
  return { driver, host, manager };
}

test("migrates legacy push and pull Connections into typed Workflows once", async () => {
  const { driver, manager } = setup();
  await createAppStorage("mybox-host", driver).writeJson("connections.json", { version: 1, connections: [
    { id: "event", source: { appId: "source", connectorId: "source.done-items", config: {} }, target: { appId: "target", connectorId: "target.consume-items", config: {} }, enabled: true, status: { state: "pending-approval", message: "承認待ち", lastEnvelope: { id: "legacy-envelope", type: "source.done", sourceAppId: "source", occurredAt: "2026-08-22T00:00:00.000Z", payload: { id: "legacy-image" } } } },
    { id: "request", source: { appId: "source", connectorId: "source.items", config: { tag: "public" } }, target: { appId: "target", connectorId: "target.library", config: {} }, enabled: true },
  ] });
  await manager.load();
  assert.deepEqual(manager.list().map((item) => item.trigger.kind).sort(), ["app-request", "event"]);
  assert.equal(manager.listRuns()[0].id, "run-connection-event-legacy-envelope");
  assert.equal(manager.listRuns()[0].state, "pending-approval");
  await manager.load();
  assert.equal(manager.list().length, 2);
  assert.equal(manager.listRuns().length, 1);
  const pulled = await manager.request("target", "target.library");
  assert.equal(pulled.items[0].config.tag, "public");
  manager.stop();
});

test("rejects Workflow Actions whose Operation does not allow the flow caller", () => {
  const host = new AppHost();
  assert.throws(() => host.register({
    manifest: {
      schemaVersion: APP_SCHEMA_VERSION,
      id: "private",
      name: "Private",
      version: "1.0.0",
      operations: [{ ...operation("private.run"), callers: ["user"] }],
      events: [],
      workflowActions: [{ id: "private.run-action", title: "Run", operationId: "private.run", configSchema: schema }],
    },
    handlers: { "private.run": () => ({}) },
  }), /must allow the flow caller/);
});

test("projects safe Agent Operations as passthrough Workflow commands", () => {
  const host = new AppHost();
  host.register({
    manifest: {
      schemaVersion: APP_SCHEMA_VERSION,
      id: "commands",
      name: "Commands",
      version: "1.0.0",
      operations: [
        agentOperation("commands.read", { inputSchema: { type: "object", required: ["filters"], properties: { filters: { type: "array", items: { type: "string" } } } } }),
        agentOperation("commands.write", { effect: "write", confirmationClass: "recoverable" }),
        agentOperation("commands.agent-only", { callers: ["user", "agent"] }),
        agentOperation("commands.purge", { effect: "destructive", confirmationClass: "always-confirm" }),
        agentOperation("commands.explicit"),
      ],
      events: [],
      workflowActions: [{ id: "commands.explicit-action", title: "Explicit", operationId: "commands.explicit", configSchema: schema }],
    },
    handlers: Object.fromEntries(["read", "write", "agent-only", "purge", "explicit"].map((name) => [`commands.${name}`, () => ({})])),
  });
  const manager = new WorkflowManager({ host, storage: createAppStorage("mybox-host", new MemoryStorageDriver()) });
  const actions = manager.listActions();
  assert.deepEqual(actions.filter((item) => item.source === "agent-command").map((item) => item.operationId).sort(), ["commands.read", "commands.write"]);
  assert.equal(actions.find((item) => item.operationId === "commands.read").passthrough, true);
  assert.deepEqual(actions.find((item) => item.operationId === "commands.read").configSchema.required, ["filters"]);
  assert.equal(actions.filter((item) => item.operationId === "commands.explicit").length, 1);
});

test("runs Agent commands with direct config while preserving a typed item", async () => {
  const delivered = [];
  const commandInputs = [];
  const { host, manager } = setup({ confirmationLevel: () => "recoverable", consume: ({ item }) => { delivered.push(item.id); return {}; } });
  host.register({
    manifest: {
      schemaVersion: APP_SCHEMA_VERSION,
      id: "commands",
      name: "Commands",
      version: "1.0.0",
      operations: [agentOperation("commands.record", { effect: "write", confirmationClass: "recoverable", inputSchema: { type: "object", required: ["label", "metadata"], properties: { label: { type: "string" }, metadata: { type: "object" } } } })],
      events: [],
    },
    handlers: { "commands.record": (input) => { commandInputs.push(input); return { recorded: true }; } },
  });
  await manager.load();
  const workflow = await manager.save({ name: "Command chain", enabled: true, trigger: { kind: "event", appId: "source", connectorId: "source.done-items" }, steps: [
    { id: "record", appId: "commands", actionId: "commands.record.command", config: { label: "one", metadata: { source: "workflow" } } },
    { id: "save", appId: "target", actionId: "target.consume-items", config: {} },
  ] });
  await host.invoke("source.publish", { id: "image-one" });
  const completed = await waitFor(manager, (value) => value.listRuns({ workflowId: workflow.id }).find((run) => run.state === "succeeded"));
  assert.deepEqual(commandInputs, [{ label: "one", metadata: { source: "workflow" } }]);
  assert.deepEqual(delivered, ["image-one"]);
  assert.equal(completed.stepRuns[0].source, "agent-command");
  assert.equal(completed.stepRuns[0].resultSummary, "1項目");
  manager.stop();
});

test("maps command input and Page titles through one durable Workflow JSON document", async () => {
  const driver = new MemoryStorageDriver();
  const received = [];
  const host = new AppHost({ storageDriver: driver });
  host.register({
    manifest: {
      schemaVersion: APP_SCHEMA_VERSION,
      id: "pages",
      name: "Pages",
      version: "1.0.0",
      operations: [agentOperation("pages.list", {
        inputSchema: { type: "object", required: ["projectId"], properties: { projectId: { type: "string", minLength: 1 } } },
        outputSchema: { type: "object", required: ["pages"], properties: { pages: { type: "array", items: { type: "object", required: ["title"], properties: { title: { type: "string" } } } } } },
      })],
      events: [],
    },
    handlers: { "pages.list": (input) => { received.push(input); return { pages: [{ title: "設計" }, { title: "旅行" }] }; } },
  });
  const storage = createAppStorage("mybox-host", driver);
  const manager = new WorkflowManager({ host, storage });
  await manager.load();
  const workflow = await manager.save({
    name: "Page titles",
    trigger: { kind: "manual" },
    documentData: { selectedProjectId: "project-one" },
    steps: [{
      id: "list-pages",
      appId: "pages",
      actionId: "pages.list.command",
      config: { projectId: "" },
      inputMappings: [{ from: "$.data.selectedProjectId", to: "$.projectId" }],
      outputMappings: [{ from: "$.pages[*].title", to: "$.data.pageTitles" }],
    }],
  });
  const run = await manager.run(workflow.id);
  await waitFor(manager, (value) => value.listRuns().find((item) => item.id === run.id)?.state === "succeeded");
  assert.deepEqual(received, [{ projectId: "project-one" }]);
  const document = await manager.readDocument(workflow.id);
  assert.deepEqual(document.data.pageTitles, ["設計", "旅行"]);
  assert.deepEqual(document.runs[run.id].steps["list-pages"].input, { projectId: "project-one" });
  assert.deepEqual(document.runs[run.id].steps["list-pages"].output.pages.map((page) => page.title), ["設計", "旅行"]);
  assert.deepEqual(await storage.list("workflow-data"), [`workflow-data/${encodeURIComponent(workflow.id)}.json`]);
  manager.stop();
});

test("pauses Agent write commands for confirmation and never retries an uncertain failure", async () => {
  const driver = new MemoryStorageDriver();
  let attempts = 0;
  const host = new AppHost({ storageDriver: driver });
  host.register({
    manifest: {
      schemaVersion: APP_SCHEMA_VERSION,
      id: "commands",
      name: "Commands",
      version: "1.0.0",
      operations: [agentOperation("commands.write", { effect: "write", confirmationClass: "recoverable" })],
      events: [],
    },
    handlers: { "commands.write": () => { attempts += 1; const error = new Error("later"); error.code = "SERVICE_UNAVAILABLE"; throw error; } },
  });
  const manager = new WorkflowManager({ host, storage: createAppStorage("mybox-host", driver), retryDelays: [0, 0, 0] });
  await manager.load();
  const workflow = await manager.save({ name: "Write", trigger: { kind: "manual" }, steps: [{ id: "write", appId: "commands", actionId: "commands.write.command", config: {} }] });
  const run = await manager.run(workflow.id);
  await waitFor(manager, (value) => value.listRuns().find((item) => item.id === run.id)?.state === "pending-approval");
  await manager.resume(run.id, { approval: { granted: true, fresh: true } });
  const failed = await waitFor(manager, (value) => value.listRuns().find((item) => item.id === run.id)?.state === "failed" && value.listRuns().find((item) => item.id === run.id));
  assert.equal(attempts, 1);
  assert.equal(failed.stepRuns[0].attempts, 2);
  manager.stop();
});

test("does not replay an interrupted non-read Agent command after restart", async () => {
  const driver = new MemoryStorageDriver();
  const storage = createAppStorage("mybox-host", driver);
  let calls = 0;
  const host = new AppHost({ storageDriver: driver });
  host.register({
    manifest: { schemaVersion: APP_SCHEMA_VERSION, id: "commands", name: "Commands", version: "1.0.0", operations: [agentOperation("commands.write", { effect: "write", confirmationClass: "recoverable" })], events: [] },
    handlers: { "commands.write": () => { calls += 1; return {}; } },
  });
  const definition = { id: "workflow-command", name: "Interrupted", enabled: true, version: 1, trigger: { kind: "manual" }, steps: [{ id: "write", appId: "commands", actionId: "commands.write.command", config: {} }], createdAt: "2026-08-22T00:00:00.000Z", updatedAt: "2026-08-22T00:00:00.000Z", status: { state: "running" } };
  const run = { id: "run-command", workflowId: definition.id, state: "running", trigger: { kind: "manual", payload: null }, currentStepIndex: 0, steps: definition.steps, createdAt: definition.createdAt, startedAt: definition.createdAt, completedAt: null, updatedAt: definition.updatedAt, attempts: 1, stepRuns: [{ stepId: "write", appId: "commands", actionId: "commands.write.command", operationId: "commands.write", source: "agent-command", effect: "write", state: "running", attempts: 1, startedAt: definition.createdAt, completedAt: null, error: null }], error: null, nextAttemptAt: null };
  await storage.writeJson("workflows.json", { version: 1, workflows: [definition], migratedConnectionIds: [] });
  await storage.writeJson("workflow-runs.json", { version: 1, runs: [run] });
  const manager = new WorkflowManager({ host, storage });
  await manager.load();
  const recovered = manager.listRuns()[0];
  assert.equal(recovered.state, "failed");
  assert.equal(recovered.error.code, "COMMAND_OUTCOME_UNKNOWN");
  assert.equal(calls, 0);
  manager.stop();
});

test("queues every Event, pauses for approval, and resumes the same deliveries in order", async () => {
  const delivered = [];
  const { host, manager } = setup({ consume: ({ item, deliveryId, config }) => { delivered.push([item.id, deliveryId, config.label]); return {}; } });
  await manager.load();
  const workflow = await manager.save({ name: "Save images", enabled: true, trigger: { kind: "event", appId: "source", connectorId: "source.done-items" }, steps: [{ id: "save", appId: "target", actionId: "target.consume-items", config: { label: "original" } }] });
  await host.invoke("source.publish", { id: "one" });
  await host.invoke("source.publish", { id: "two" });
  await waitFor(manager, (value) => value.listRuns({ workflowId: workflow.id }).find((run) => run.state === "pending-approval"));
  let paused = manager.listRuns({ workflowId: workflow.id }).find((run) => run.state === "pending-approval");
  await manager.save({ ...workflow, steps: [{ ...workflow.steps[0], config: { label: "edited" } }] });
  await manager.resume(paused.id, { approval: { granted: true, fresh: true } });
  await waitFor(manager, (value) => value.listRuns({ workflowId: workflow.id }).filter((run) => run.state === "pending-approval").length === 1);
  paused = manager.listRuns({ workflowId: workflow.id }).find((run) => run.state === "pending-approval");
  await manager.resume(paused.id, { approval: { granted: true, fresh: true } });
  await waitFor(manager, (value) => value.listRuns({ workflowId: workflow.id }).filter((run) => run.state === "succeeded").length === 2);
  assert.deepEqual(delivered.map(([itemId]) => itemId), ["one", "two"]);
  assert.equal(new Set(delivered.map(([, deliveryId]) => deliveryId)).size, 2);
  assert.deepEqual(delivered.map(([, , label]) => label), ["original", "original"]);
  manager.stop();
});

test("runs no-input Actions manually and retries transient failures three times", async () => {
  const driver = new MemoryStorageDriver(); let attempts = 0;
  const host = new AppHost({ storageDriver: driver });
  host.register({
    manifest: { schemaVersion: APP_SCHEMA_VERSION, id: "worker", name: "Worker", version: "1.0.0", operations: [operation("worker.run", "external", "review")], events: [], connectors: { sources: [], targets: [] }, workflowActions: [{ id: "worker.run-action", title: "Run", operationId: "worker.run", inputDataType: null, outputDataType: null, configSchema: schema }] },
    handlers: { "worker.run": () => { attempts += 1; if (attempts < 4) { const error = new Error("later"); error.code = "SERVICE_UNAVAILABLE"; throw error; } return {}; } },
  });
  const manager = new WorkflowManager({ host, storage: createAppStorage("mybox-host", driver), confirmationLevel: () => "autonomous", retryDelays: [0, 0, 0] });
  await manager.load();
  const workflow = await manager.save({ name: "Retry", trigger: { kind: "manual" }, steps: [{ id: "run", appId: "worker", actionId: "worker.run-action", config: {} }] });
  const run = await manager.run(workflow.id);
  await waitFor(manager, (value) => value.listRuns().find((item) => item.id === run.id)?.state === "succeeded");
  assert.equal(attempts, 4);
  manager.stop();
});

test("coalesces missed schedule occurrences to the latest wall-clock slot", async () => {
  let current = new Date("2026-08-22T01:10:00.000Z");
  const driver = new MemoryStorageDriver(); let executions = 0;
  const host = new AppHost({ storageDriver: driver });
  host.register({
    manifest: { schemaVersion: APP_SCHEMA_VERSION, id: "worker", name: "Worker", version: "1.0.0", operations: [operation("worker.run")], events: [], connectors: { sources: [], targets: [] }, workflowActions: [{ id: "worker.run-action", title: "Run", operationId: "worker.run", inputDataType: null, outputDataType: null, configSchema: schema }] },
    handlers: { "worker.run": () => { executions += 1; return {}; } },
  });
  const manager = new WorkflowManager({ host, storage: createAppStorage("mybox-host", driver), clock: () => current, setTimeoutFn: () => null });
  await manager.load();
  const workflow = await manager.save({ name: "Hourly", trigger: { kind: "schedule", schedule: { frequency: "hourly", minute: 15, timeZone: "UTC" } }, steps: [{ id: "run", appId: "worker", actionId: "worker.run-action", config: {} }] });
  assert.equal(latestScheduleOccurrence(workflow.trigger.schedule, current), "2026-08-22T00:15");
  current = new Date("2026-08-22T04:30:00.000Z");
  await manager.tickSchedules(current);
  await waitFor(manager, () => executions === 1);
  assert.equal(manager.listRuns({ workflowId: workflow.id }).length, 1);
  manager.stop();
});
