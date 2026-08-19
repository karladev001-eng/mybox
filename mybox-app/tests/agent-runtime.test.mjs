import assert from "node:assert/strict";
import test from "node:test";
import { APP_SCHEMA_VERSION, defineApp } from "../src/core/app-contract.js";
import { AppHost } from "../src/core/app-host.js";
import { AgentProviderRegistry, defineAgentProvider } from "../src/core/agent-provider.js";
import { AgentRuntime } from "../src/core/agent-runtime.js";
import { MemoryStorageDriver } from "../src/core/storage.js";
import { createKnowledgeApp } from "../src/knowledge/app.js";

function createEchoApp() {
  return defineApp({
    manifest: {
      schemaVersion: APP_SCHEMA_VERSION,
      id: "echo",
      name: "Echo",
      version: "0.1.0",
      operations: [
        {
          id: "echo.read",
          title: "Read a value",
          effect: "read",
          confirmationClass: "review",
          callers: ["agent"],
          inputSchema: {
            type: "object",
            required: ["value"],
            additionalProperties: false,
            properties: { value: { type: "string" } },
          },
          outputSchema: {
            type: "object",
            required: ["value"],
            additionalProperties: false,
            properties: { value: { type: "string" } },
          },
        },
        {
          id: "echo.write",
          title: "Write a value",
          effect: "write",
          confirmationClass: "recoverable",
          callers: ["agent"],
          inputSchema: {
            type: "object",
            required: ["value"],
            additionalProperties: false,
            properties: { value: { type: "string" } },
          },
          outputSchema: {
            type: "object",
            required: ["written"],
            additionalProperties: false,
            properties: { written: { type: "boolean" } },
          },
        },
      ],
      events: [],
    },
    handlers: {
      async "echo.read"(input) {
        return input;
      },
      async "echo.write"() {
        return { written: true };
      },
    },
  });
}

test("registers subscription, API, and local providers without plan-tier coupling", () => {
  const registry = new AgentProviderRegistry();
  for (const kind of ["subscription", "api", "local"]) {
    registry.register(defineAgentProvider({
      descriptor: {
        id: `${kind}-fixture`,
        name: kind,
        kind,
        authMode: kind === "local" ? "none" : "fixture",
        capabilities: { text: true },
      },
      getStatus: async () => ({ connected: true, planType: "any-future-plan" }),
      generate: async () => ({ text: "{}" }),
    }));
  }
  assert.deepEqual(registry.list().map(({ kind }) => kind), ["subscription", "api", "local"]);
});

test("routes provider decisions through AppHost grants and returns observations", async () => {
  const host = new AppHost();
  host.register(createEchoApp());
  const decisions = [
    { type: "invoke", operationId: "echo.read", input: { value: "hello" }, reason: "need the value" },
    { type: "respond", message: "受け取りました" },
  ];
  const registry = new AgentProviderRegistry();
  registry.register({
    descriptor: {
      id: "subscription-fixture",
      name: "Subscription fixture",
      kind: "subscription",
      authMode: "chatgpt",
      capabilities: { text: true, structuredOutput: true },
    },
    getStatus: async () => ({ connected: true, planType: "plus" }),
    generate: async () => ({ data: decisions.shift() }),
  });

  const runtime = new AgentRuntime({ host, providers: registry });
  const result = await runtime.run("値を確認", {
    providerId: "subscription-fixture",
    grant: { operationIds: ["echo.read"] },
  });

  assert.equal(result.message, "受け取りました");
  assert.deepEqual(result.observations, [{ operationId: "echo.read", output: { value: "hello" } }]);
});

test("accepts an Operation payload sent as a JSON string, and a schema Structured Outputs allows", async () => {
  const host = new AppHost();
  host.register(createEchoApp());
  // What the shipped schema actually asks a provider for: one flat object with
  // every field present, unused ones null, and the payload JSON-encoded.
  const decisions = [
    { type: "invoke", operationId: "echo.read", inputJson: "{\"value\":\"hello\"}", reason: "need the value", message: null },
    { type: "respond", message: "受け取りました", operationId: null, inputJson: null, reason: null },
  ];
  const schemas = [];
  const registry = new AgentProviderRegistry();
  registry.register({
    descriptor: {
      id: "subscription-fixture",
      name: "Subscription fixture",
      kind: "subscription",
      authMode: "chatgpt",
      capabilities: { text: true, structuredOutput: true },
    },
    getStatus: async () => ({ connected: true, planType: "plus" }),
    generate: async ({ responseSchema }) => {
      schemas.push(responseSchema);
      return { data: decisions.shift() };
    },
  });

  const runtime = new AgentRuntime({ host, providers: registry });
  const result = await runtime.run("値を確認", {
    providerId: "subscription-fixture",
    grant: { operationIds: ["echo.read"] },
  });

  assert.deepEqual(result.observations, [{ operationId: "echo.read", output: { value: "hello" } }]);

  // Codex hands the schema straight to OpenAI, which rejects `oneOf` outright
  // and requires every property to be required with no free-form objects.
  const [schema] = schemas;
  assert.equal("oneOf" in schema, false);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual([...schema.required].sort(), ["inputJson", "message", "operationId", "reason", "type"]);
  Object.values(schema.properties).forEach((property) => assert.notEqual(property.type, "object"));
});

test("rejects a provider decision that is not exposed to agents", async () => {
  const host = new AppHost();
  host.register(createEchoApp());
  const registry = new AgentProviderRegistry();
  registry.register({
    descriptor: {
      id: "unsafe-fixture",
      name: "Unsafe fixture",
      kind: "local",
      authMode: "none",
      capabilities: { text: true },
    },
    getStatus: async () => ({ connected: true }),
    generate: async () => ({ data: { type: "invoke", operationId: "files.raw-read", input: {}, reason: "bypass" } }),
  });

  const runtime = new AgentRuntime({ host, providers: registry });
  await assert.rejects(
    runtime.run("private file", { providerId: "unsafe-fixture" }),
    (error) => error.code === "INVALID_AGENT_DECISION",
  );
});

test("a write beyond the Confirmation level is denied without an approval callback, and the agent can still respond", async () => {
  const host = new AppHost();
  host.register(createEchoApp());
  const decisions = [
    { type: "invoke", operationId: "echo.write", input: { value: "hello" }, reason: "try to write" },
    { type: "respond", message: "書き込みは許可されませんでした" },
  ];
  const registry = new AgentProviderRegistry();
  registry.register({
    descriptor: {
      id: "subscription-fixture",
      name: "Subscription fixture",
      kind: "subscription",
      authMode: "chatgpt",
      capabilities: { text: true, structuredOutput: true },
    },
    getStatus: async () => ({ connected: true, planType: "plus" }),
    generate: async () => ({ data: decisions.shift() }),
  });

  const runtime = new AgentRuntime({ host, providers: registry });
  const result = await runtime.run("値を書き込む", {
    providerId: "subscription-fixture",
    grant: { operationIds: ["*"] },
    // confirmationLevel defaults to "review", below echo.write's "recoverable"
  });

  assert.equal(result.message, "書き込みは許可されませんでした");
  assert.deepEqual(result.observations, [{ operationId: "echo.write", output: { error: "APPROVAL_DENIED" } }]);
});

test("a raised Confirmation level reaches the Host, so the write runs with no approval callback at all", async () => {
  const host = new AppHost();
  host.register(createEchoApp());
  const decisions = [
    { type: "invoke", operationId: "echo.write", input: { value: "hello" }, reason: "write it" },
    { type: "respond", message: "書き込みました" },
  ];
  const registry = new AgentProviderRegistry();
  registry.register({
    descriptor: {
      id: "subscription-fixture",
      name: "Subscription fixture",
      kind: "subscription",
      authMode: "chatgpt",
      capabilities: { text: true, structuredOutput: true },
    },
    getStatus: async () => ({ connected: true, planType: "plus" }),
    generate: async () => ({ data: decisions.shift() }),
  });

  const runtime = new AgentRuntime({ host, providers: registry });
  // The Host applies the level itself and defaults to "review"; if the runtime
  // does not forward it, Autonomous fails the write it is supposed to permit.
  const result = await runtime.run("値を書き込む", {
    providerId: "subscription-fixture",
    grant: { operationIds: ["*"] },
    confirmationLevel: "autonomous",
  });

  assert.equal(result.message, "書き込みました");
  assert.deepEqual(result.observations, [{ operationId: "echo.write", output: { written: true } }]);
});

test("a write beyond the Confirmation level runs once the approval callback grants it, with the model's own input previewed", async () => {
  const host = new AppHost();
  host.register(createEchoApp());
  const decisions = [
    { type: "invoke", operationId: "echo.write", input: { value: "hello" }, reason: "try to write" },
    { type: "respond", message: "書き込みました" },
  ];
  const registry = new AgentProviderRegistry();
  registry.register({
    descriptor: {
      id: "subscription-fixture",
      name: "Subscription fixture",
      kind: "subscription",
      authMode: "chatgpt",
      capabilities: { text: true, structuredOutput: true },
    },
    getStatus: async () => ({ connected: true, planType: "plus" }),
    generate: async () => ({ data: decisions.shift() }),
  });

  const seenApprovalRequests = [];
  const runtime = new AgentRuntime({ host, providers: registry });
  const result = await runtime.run("値を書き込む", {
    providerId: "subscription-fixture",
    grant: { operationIds: ["*"] },
    onApprovalNeeded: async (details) => {
      seenApprovalRequests.push(details);
      return true;
    },
  });

  assert.equal(result.message, "書き込みました");
  assert.deepEqual(result.observations, [{ operationId: "echo.write", output: { written: true } }]);
  assert.equal(seenApprovalRequests.length, 1);
  assert.equal(seenApprovalRequests[0].operationId, "echo.write");
  assert.deepEqual(seenApprovalRequests[0].input, { value: "hello" });
  assert.equal(seenApprovalRequests[0].confirmationClass, "recoverable");
});

/**
 * The whole agent path against the real Knowledge App, not a fixture. The three
 * failures this feature shipped with (a `oneOf` schema, a dropped Confirmation
 * level, and an opaque mutation schema) all lived between the pieces the other
 * tests cover, so this exercises decision -> schema -> Host -> domain end to end.
 */
test("edits a real Knowledge Page end to end, recovering from a rejected mutation", async () => {
  const host = new AppHost({ storageDriver: new MemoryStorageDriver() });
  host.register(createKnowledgeApp());
  const actor = { type: "user", id: "local-user" };
  const { projects } = await host.invoke("knowledge.project.list", {}, { actor });
  const projectId = projects[0].id;
  const { page } = await host.invoke("knowledge.page.create", { projectId, title: "Agent Page" }, { actor });

  const decisions = [
    // What the model actually sent: a mutation with no `type`.
    {
      type: "invoke",
      operationId: "knowledge.page.update",
      inputJson: JSON.stringify({ projectId, pageId: page.id, expectedRevision: page.revision, mutation: { text: "こんにちは" } }),
      reason: "本文を書く",
      message: null,
    },
    // Having seen the rejection, it names a mutation type from the schema.
    {
      type: "invoke",
      operationId: "knowledge.page.update",
      inputJson: JSON.stringify({
        projectId,
        pageId: page.id,
        expectedRevision: page.revision,
        mutation: { type: "block-add", afterBlockId: null, blockType: "paragraph", text: "こんにちは" },
      }),
      reason: "本文を追加する",
      message: null,
    },
    { type: "respond", message: "追加しました", operationId: null, inputJson: null, reason: null },
  ];

  const registry = new AgentProviderRegistry();
  registry.register({
    descriptor: {
      id: "subscription-fixture",
      name: "Subscription fixture",
      kind: "subscription",
      authMode: "chatgpt",
      capabilities: { text: true, structuredOutput: true },
    },
    getStatus: async () => ({ connected: true, planType: "plus" }),
    generate: async () => ({ data: decisions.shift() }),
  });

  const runtime = new AgentRuntime({ host, providers: registry });
  const result = await runtime.run("Pageに本文を追加して", {
    providerId: "subscription-fixture",
    grant: { operationIds: ["*"] },
    confirmationLevel: "autonomous",
  });

  assert.equal(result.message, "追加しました");
  // The bad mutation is refused by the Operation's schema, before the domain,
  // and is reported back to the model rather than ending the turn.
  assert.equal(result.observations[0].output.error, "INVALID_OPERATION_INPUT");
  assert.equal(result.observations[1].output.page.blocks.at(-1).text, "こんにちは");

  const read = await host.invoke("knowledge.page.read", { projectId, pageId: page.id }, { actor });
  assert.equal(read.page.blocks.at(-1).text, "こんにちは");
});

test("does not report success when every Operation it tried was rejected", async () => {
  const host = new AppHost({ storageDriver: new MemoryStorageDriver() });
  host.register(createKnowledgeApp());
  const actor = { type: "user", id: "local-user" };
  const { projects } = await host.invoke("knowledge.project.list", {}, { actor });
  const projectId = projects[0].id;
  const { page } = await host.invoke("knowledge.page.create", { projectId, title: "Agent Page" }, { actor });

  const decisions = [
    {
      type: "invoke",
      operationId: "knowledge.page.update",
      inputJson: JSON.stringify({ projectId, pageId: page.id, expectedRevision: page.revision, mutation: { text: "x" } }),
      reason: "本文を書く",
      message: null,
    },
    // The model gives up and claims it worked anyway.
    { type: "respond", message: "はい、編集しました", operationId: null, inputJson: null, reason: null },
  ];
  const registry = new AgentProviderRegistry();
  registry.register({
    descriptor: {
      id: "subscription-fixture",
      name: "Subscription fixture",
      kind: "subscription",
      authMode: "chatgpt",
      capabilities: { text: true, structuredOutput: true },
    },
    getStatus: async () => ({ connected: true, planType: "plus" }),
    generate: async () => ({ data: decisions.shift() }),
  });

  const runtime = new AgentRuntime({ host, providers: registry });
  await assert.rejects(
    () => runtime.run("Pageを編集して", {
      providerId: "subscription-fixture",
      grant: { operationIds: ["*"] },
      confirmationLevel: "autonomous",
    }),
    (error) => error.code === "INVALID_OPERATION_INPUT",
  );

  const read = await host.invoke("knowledge.page.read", { projectId, pageId: page.id }, { actor });
  assert.equal(read.page.title, "Agent Page");
});
