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
