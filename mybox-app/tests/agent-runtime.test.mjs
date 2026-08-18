import assert from "node:assert/strict";
import test from "node:test";
import { APP_SCHEMA_VERSION, defineApp } from "../src/core/app-contract.js";
import { AppHost } from "../src/core/app-host.js";
import { AgentProviderRegistry, defineAgentProvider } from "../src/core/agent-provider.js";
import { AgentRuntime } from "../src/core/agent-runtime.js";

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
