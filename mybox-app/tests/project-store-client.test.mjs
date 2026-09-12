import test from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { createProjectStoreClient } from "../src/knowledge/project-store-client.js";

const settle = () => new Promise((resolve) => setImmediate(resolve));

function memoryProjectStore() {
  const updates = [];
  let sequence = 0;
  return {
    updates,
    async read(_projectId, knownIds) {
      const known = new Set(knownIds);
      return updates.filter((item) => !known.has(item.id));
    },
    async write(_projectId, update) {
      const id = `update-${++sequence}`;
      updates.push({ id, update });
      return id;
    },
  };
}

test("Project-store clients merge edits without echoing pulled updates", async () => {
  const folder = memoryProjectStore();
  const timersA = [];
  const timersB = [];
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const clientA = createProjectStoreClient({
    doc: docA,
    projectId: "project-cloud",
    readUpdates: folder.read,
    writeUpdate: folder.write,
    setTimer: (callback) => { timersA.push(callback); return timersA.length; },
    clearTimer: () => {},
  });
  const clientB = createProjectStoreClient({
    doc: docB,
    projectId: "project-cloud",
    readUpdates: folder.read,
    writeUpdate: folder.write,
    setTimer: (callback) => { timersB.push(callback); return timersB.length; },
    clearTimer: () => {},
  });

  await clientA.connect();
  docA.getMap("project").set("title", "端末A");
  await settle();
  await clientB.connect();
  assert.equal(docB.getMap("project").get("title"), "端末A");

  docB.getMap("project").set("deviceB", "編集B");
  await settle();
  const writesBeforePull = folder.updates.length;
  await timersA.shift()();
  assert.equal(docA.getMap("project").get("deviceB"), "編集B");
  assert.equal(folder.updates.length, writesBeforePull, "a pulled update must not be written back as a new file");

  clientA.disconnect();
  clientB.disconnect();
});

test("Project-store client retries a full state after a provider write failure", async () => {
  const doc = new Y.Doc();
  const statuses = [];
  const errors = [];
  const timers = [];
  let fail = true;
  const stored = [];
  const client = createProjectStoreClient({
    doc,
    projectId: "project-retry",
    readUpdates: async () => [],
    writeUpdate: async (_projectId, update) => {
      if (fail) throw new Error("provider offline");
      stored.push(update);
      return `saved-${stored.length}`;
    },
    onStatus: ({ status }) => statuses.push(status),
    onError: (error) => errors.push(error.message),
    setTimer: (callback) => { timers.push(callback); return timers.length; },
    clearTimer: () => {},
  });

  doc.getMap("project").set("draft", "offline edit");
  await client.connect();
  assert.equal(client.status, "offline");
  assert.deepEqual(errors, ["provider offline"]);

  fail = false;
  await timers.shift()();
  assert.equal(client.status, "connected");
  assert.equal(stored.length, 1);
  assert.ok(statuses.includes("offline"));
  client.disconnect();
});


test("reopening an update log notifies once and still persists subsequent edits", async () => {
  const source = new Y.Doc();
  const folder = memoryProjectStore();
  source.on("update", (update) => folder.write("replay", Buffer.from(update).toString("base64")));
  for (let i = 0; i < 100; i++) source.getMap("data").set(String(i), i);
  const doc = new Y.Doc();
  let notifications = 0;
  doc.on("update", () => notifications++);
  const client = createProjectStoreClient({ doc, projectId: "replay", readUpdates: folder.read, writeUpdate: folder.write, setTimer: () => 1, clearTimer() {} });
  await client.connect();
  assert.equal(notifications, 1);
  assert.equal(doc.getMap("data").size, 100);
  assert.equal(folder.updates.length, 101, "only the existing connect snapshot is written");
  doc.getMap("data").set("local", "saved");
  await client.flush();
  const restored = new Y.Doc();
  for (const item of folder.updates) Y.applyUpdate(restored, Buffer.from(item.update, "base64"));
  assert.equal(restored.getMap("data").get("local"), "saved");
  client.disconnect();
  source.destroy(); doc.destroy(); restored.destroy();
});
