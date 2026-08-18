import assert from "node:assert/strict";
import test from "node:test";
import { createAppInstallationsStore } from "../src/core/app-installations.js";
import { compareAppVersions, isAppUpdateAvailable } from "../src/core/app-version.js";
import { createAppStorage, MemoryStorageDriver } from "../src/core/storage.js";
import {
  AppRegistry,
  createCustomAppDefinition,
  createMyBoxAppRegistry,
} from "../src/apps/registry.js";

test("registers the Knowledge module surface in the default installed catalog", () => {
  const registry = createMyBoxAppRegistry();
  const knowledge = registry.get("knowledge");
  assert.equal(knowledge.surface.kind, "module");
  assert.equal(knowledge.surface.exportName, "KnowledgeView");
  assert.equal(typeof knowledge.surface.load, "function");
  assert.equal(knowledge.version, "1.4.0");
  assert.equal(registry.listDefaultInstalled().some((app) => app.id === "knowledge"), true);
});

test("rejects duplicate IDs and malformed module surfaces", () => {
  const registry = new AppRegistry();
  registry.register({ id: "sample", version: "1.0.0", name: "Sample", icon: "code", color: "#67d7c4", hint: "Sample App" });
  assert.throws(
    () => registry.register({ id: "sample", version: "1.0.0", name: "Again", icon: "code", color: "#67d7c4", hint: "Duplicate" }),
    (error) => error.code === "APP_ID_CONFLICT",
  );
  assert.throws(
    () => registry.register({ id: "module", version: "1.0.0", name: "Module", icon: "code", color: "#67d7c4", hint: "Module", surface: { kind: "module", exportName: "View" } }),
    (error) => error.code === "INVALID_APP_SURFACE",
  );
  assert.throws(
    () => registry.register({ id: "invalid-version", version: "1.0", name: "Invalid", icon: "code", color: "#67d7c4", hint: "Invalid" }),
    (error) => error.code === "INVALID_APP_VERSION",
  );
});

test("creates custom generic App definitions that join the same registry", () => {
  const registry = createMyBoxAppRegistry();
  const custom = createCustomAppDefinition({
    name: "ログ解析",
    icon: "code",
    color: "#67d7c4",
    now: () => 42,
  });
  registry.register(custom);
  assert.equal(registry.get("custom-42").surface.kind, "generic");
  assert.equal(registry.list().at(-1).name, "ログ解析");
});

test("persists installed versions and keeps removed custom Apps in the catalog", async () => {
  const driver = new MemoryStorageDriver();
  const registry = createMyBoxAppRegistry();
  const custom = registry.register(createCustomAppDefinition({
    name: "再追加可能",
    icon: "code",
    color: "#67d7c4",
    now: () => 99,
  }));
  const store = createAppInstallationsStore(createAppStorage("mybox-host", driver), {
    defaultInstalledApps: registry.listDefaultInstalled(),
    availableApps: registry.list(),
  });
  await store.save(registry.listDefaultInstalled(), registry.list());

  const restored = await store.load();
  assert.equal(restored.installedApps.some((app) => app.id === custom.id), false);
  assert.equal(restored.customApps.some((app) => app.id === custom.id), true);
});

test("compares stable and prerelease App versions using SemVer precedence", () => {
  assert.equal(compareAppVersions("1.2.0", "1.1.9"), 1);
  assert.equal(compareAppVersions("2.0.0-beta.1", "2.0.0"), -1);
  assert.equal(compareAppVersions("1.0.0+build.2", "1.0.0+build.1"), 0);
  assert.equal(isAppUpdateAvailable("1.0.0", "1.1.0"), true);
  assert.equal(isAppUpdateAvailable("1.1.0", "1.1.0"), false);
});

test("migrates legacy installed IDs without showing false updates", async () => {
  const driver = new MemoryStorageDriver();
  const storage = createAppStorage("mybox-host", driver);
  const registry = createMyBoxAppRegistry();
  await storage.writeJson("apps/installations.json", {
    schemaVersion: 1,
    installedAppIds: ["knowledge"],
    customApps: [{ id: "custom-old", name: "旧App", icon: "code", color: "#67d7c4", hint: "カスタムアプリ" }],
  });
  const store = createAppInstallationsStore(storage, {
    defaultInstalledApps: registry.listDefaultInstalled(),
    availableApps: registry.list(),
  });

  const restored = await store.load();
  assert.deepEqual(restored.installedApps, [{ id: "knowledge", version: registry.get("knowledge").version }]);
  assert.equal(restored.customApps[0].version, "1.0.0");
});

test("persists an installed App update independently from the Registry version", async () => {
  const driver = new MemoryStorageDriver();
  const registry = new AppRegistry();
  const app = registry.register({ id: "sample", version: "1.2.0", name: "Sample", icon: "code", color: "#67d7c4", hint: "Sample App" });
  const store = createAppInstallationsStore(createAppStorage("mybox-host", driver), {
    defaultInstalledApps: [],
    availableApps: registry.list(),
  });

  await store.save([app], registry.list(), { sample: "1.0.0" });
  assert.deepEqual((await store.load()).installedApps, [{ id: "sample", version: "1.0.0" }]);

  await store.save([app], registry.list(), { sample: app.version });
  assert.deepEqual((await store.load()).installedApps, [{ id: "sample", version: "1.2.0" }]);
});
