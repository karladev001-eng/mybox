import assert from "node:assert/strict";
import test from "node:test";
import { APP_SCHEMA_VERSION, defineApp } from "../src/core/app-contract.js";
import { AppHost } from "../src/core/app-host.js";
import {
  createAggregateAgentHost,
  getAgentHost,
  hasRegisteredAgentHosts,
  registerAgentHost,
} from "../src/core/agent-host-registry.js";

function registerFixtureApp(id) {
  const host = new AppHost();
  host.register(defineApp({
    manifest: {
      schemaVersion: APP_SCHEMA_VERSION,
      id,
      name: id,
      version: "0.1.0",
      operations: [{
        id: `${id}.ping`,
        title: "Ping",
        effect: "read",
        confirmationClass: "review",
        callers: ["agent"],
        inputSchema: { type: "object" },
        outputSchema: {
          type: "object",
          required: ["from"],
          additionalProperties: false,
          properties: { from: { type: "string" } },
        },
      }],
      events: [],
    },
    handlers: {
      async [`${id}.ping`]() {
        return { from: id };
      },
    },
  }));
  const unregister = registerAgentHost(id, host);
  return { host, unregister };
}

test("registerAgentHost makes a host findable by App ID and forgettable", () => {
  const { host, unregister } = registerFixtureApp("registry-fixture-a");
  assert.equal(getAgentHost("registry-fixture-a"), host);
  unregister();
  assert.equal(getAgentHost("registry-fixture-a"), null);
});

test("hasRegisteredAgentHosts reflects registration and unregistration", () => {
  assert.equal(getAgentHost("registry-fixture-b"), null);
  const { unregister } = registerFixtureApp("registry-fixture-b");
  assert.equal(hasRegisteredAgentHosts(), true);
  unregister();
});

test("the aggregate host unions Operations across every registered App and routes invoke by ID prefix", async () => {
  const a = registerFixtureApp("registry-fixture-c");
  const b = registerFixtureApp("registry-fixture-d");
  try {
    const aggregate = createAggregateAgentHost();
    const ids = aggregate.listOperations({ callerType: "agent" }).map((operation) => operation.id);
    assert.ok(ids.includes("registry-fixture-c.ping"));
    assert.ok(ids.includes("registry-fixture-d.ping"));

    const options = { actor: { type: "agent", id: "test" }, grant: { operationIds: ["*"] } };
    const resultC = await aggregate.invoke("registry-fixture-c.ping", {}, options);
    const resultD = await aggregate.invoke("registry-fixture-d.ping", {}, options);
    assert.deepEqual(resultC, { from: "registry-fixture-c" });
    assert.deepEqual(resultD, { from: "registry-fixture-d" });
  } finally {
    a.unregister();
    b.unregister();
  }
});

test("the aggregate host rejects an Operation ID no registered App owns", async () => {
  const aggregate = createAggregateAgentHost();
  await assert.rejects(
    aggregate.invoke("nobody.ping", {}, { actor: { type: "agent", id: "test" } }),
    /No registered App host owns operation/,
  );
});
