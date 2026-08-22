import assert from "node:assert/strict";
import test from "node:test";
import { APP_SCHEMA_VERSION } from "../src/core/app-contract.js";
import { AppHost } from "../src/core/app-host.js";
import { ConnectionManager } from "../src/core/connections.js";
import { ResourceBroker, validateResourceReference } from "../src/core/resource-broker.js";
import { createAppStorage, MemoryStorageDriver } from "../src/core/storage.js";

const schema = { type: "object" };
const operation = (id, effect = "read", confirmationClass = "review") => ({ id, title: id, effect, confirmationClass, callers: ["user", "app", "flow"], inputSchema: schema, outputSchema: schema });

test("persists compatible pull Connections and scopes the source grant", async () => {
  const driver = new MemoryStorageDriver(); let manager;
  const host = new AppHost({ storageDriver: driver, connections: { pull: (...args) => manager.pull(...args) } });
  host.register({ manifest: { schemaVersion: APP_SCHEMA_VERSION, id: "source", name: "Source", version: "1.0.0", operations: [operation("source.items.list")], events: [], connectors: { sources: [{ id: "source.items", title: "Items", mode: "pull", dataType: "mybox.prompt-fragment.v1", operationId: "source.items.list", configSchema: schema }], targets: [] } }, handlers: { "source.items.list": ({ config }) => ({ items: [{ id: "one", config }] }) } });
  host.register({ manifest: { schemaVersion: APP_SCHEMA_VERSION, id: "target", name: "Target", version: "1.0.0", operations: [operation("target.read")], events: [], connectors: { sources: [], targets: [{ id: "target.library", title: "Library", mode: "pull", dataType: "mybox.prompt-fragment.v1", configSchema: schema }] } }, handlers: { "target.read": async (_, context) => context.connections.pull("target.library") } });
  manager = new ConnectionManager({ host, storage: createAppStorage("mybox-host", driver) }); await manager.load();
  await manager.save({ source: { appId: "source", connectorId: "source.items", config: { tag: "public" } }, target: { appId: "target", connectorId: "target.library", config: {} } });
  const pulled = await host.invoke("target.read", {}, { actor: { type: "user", id: "local" } });
  assert.equal(pulled.items[0].config.tag, "public");
  const restarted = new ConnectionManager({ host, storage: createAppStorage("mybox-host", driver) }); await restarted.load();
  assert.equal(restarted.list().length, 1);
  host.unregister("source");
  await restarted.load();
  assert.equal(restarted.list()[0].status.state, "stopped");
});

test("delivers push Events once, records approval waits, and retries the same delivery", async () => {
  const driver = new MemoryStorageDriver(); let manager; const deliveries = new Set(); let consumed = 0;
  const host = new AppHost({ storageDriver: driver });
  host.register({ manifest: { schemaVersion: APP_SCHEMA_VERSION, id: "source", name: "Source", version: "1.0.0", operations: [operation("source.publish", "write", "recoverable")], events: [{ id: "source.done", title: "Done", payloadSchema: schema }], connectors: { sources: [{ id: "source.done-items", title: "Done", mode: "push", dataType: "mybox.generated-image.v1", eventId: "source.done", configSchema: schema }], targets: [] } }, handlers: { "source.publish": async (input, { emit }) => { await emit("source.done", input); return {}; } } });
  host.register({ manifest: { schemaVersion: APP_SCHEMA_VERSION, id: "target", name: "Target", version: "1.0.0", operations: [operation("target.consume", "write", "recoverable")], events: [], connectors: { sources: [], targets: [{ id: "target.consume-items", title: "Consume", mode: "consume", dataType: "mybox.generated-image.v1", operationId: "target.consume", configSchema: schema }] } }, handlers: { "target.consume": ({ deliveryId }) => { if (!deliveries.has(deliveryId)) { deliveries.add(deliveryId); consumed += 1; } return { consumed }; } } });
  manager = new ConnectionManager({ host, storage: createAppStorage("mybox-host", driver), confirmationLevel: () => "review" }); await manager.load();
  const record = await manager.save({ source: { appId: "source", connectorId: "source.done-items", config: {} }, target: { appId: "target", connectorId: "target.consume-items", config: {} } });
  await host.invoke("source.publish", { generationId: "g1" }, { actor: { type: "user", id: "local" } });
  assert.equal(manager.list()[0].status.state, "pending-approval");
  await manager.retry(record.id, { approval: { granted: true, fresh: true } });
  await manager.retry(record.id, { approval: { granted: true, fresh: true } });
  assert.equal(consumed, 1);
});

test("validates and brokers Resource references without JSON base64 payloads", async () => {
  const reference = { appId: "source", resourceId: "image.png", mediaType: "image/png", revision: 1 };
  assert.equal(validateResourceReference(reference), reference);
  assert.throws(() => validateResourceReference({ ...reference, resourceId: "../image.png" }), (error) => error.code === "INVALID_RESOURCE_REFERENCE");
  const broker = new ResourceBroker();
  broker.register("source", { read: async () => "raw-base64" });
  broker.register("target", { importResource: async (bytes) => ({ appId: "target", resourceId: `${bytes}.png`, mediaType: "image/png", revision: 1 }) });
  assert.equal((await broker.import("target", reference)).resourceId, "raw-base64.png");
});
