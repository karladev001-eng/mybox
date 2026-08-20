import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultHostSession,
  createHostSessionStore,
  resolveHostSession,
} from "../src/core/host-session.js";
import { createAppStorage, MemoryStorageDriver } from "../src/core/storage.js";

test("restores a Host view and an installed App surface", async () => {
  const storage = createAppStorage("mybox-host", new MemoryStorageDriver());
  const store = createHostSessionStore(storage);
  assert.deepEqual(await store.load(), createDefaultHostSession());
  await store.save({ view: "apps", appId: "knowledge" });
  assert.deepEqual(resolveHostSession(await store.load(), ["knowledge"]), {
    schemaVersion: 1,
    view: "apps",
    appId: "knowledge",
  });
});

test("drops a remembered App surface that is no longer installed", async () => {
  assert.deepEqual(resolveHostSession({ schemaVersion: 1, view: "apps", appId: "removed-app" }, ["knowledge"]), {
    schemaVersion: 1,
    view: "apps",
    appId: null,
  });
});
