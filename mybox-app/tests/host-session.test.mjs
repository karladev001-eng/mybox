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

test("normalizes retired Workflow destinations to home", () => {
  assert.equal(resolveHostSession({ schemaVersion: 1, view: "connections", appId: null }, []).view, "apps");
});

test("retired Workflow destinations do not restore a hidden execution surface", () => {
  for (const view of ["history", "workflows", "connections"]) {
    assert.deepEqual(resolveHostSession({ schemaVersion: 1, view, appId: null }, []), { schemaVersion: 1, view: "apps", appId: null });
  }
});

test("Host can retire Workflow startup without reading or mutating stored definitions", async () => {
  const { createSharedAppRuntime } = await import("../src/core/app-runtime.js");
  const runtime = createSharedAppRuntime({ enableWorkflows: false });
  runtime.workflows.load = () => { throw new Error("must not load retired workflows"); };
  await runtime.start();
  runtime.stop();
});
