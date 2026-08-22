import assert from "node:assert/strict";
import test from "node:test";
import { createAppStorage, MemoryStorageDriver } from "../src/core/storage.js";

test("stores UTF-8 text independently and enforces byte limits", async () => {
  const storage = createAppStorage("image-studio", new MemoryStorageDriver());
  await storage.writeText("templates/one.md", "世界観：水彩");
  assert.equal(await storage.readText("templates/one.md"), "世界観：水彩");
  await assert.rejects(storage.writeText("templates/large.md", "あ".repeat(100), { maxBytes: 16 }), (error) => error.code === "TEXT_TOO_LARGE");
  await assert.rejects(storage.writeText("../escape.md", "x"), (error) => error.code === "INVALID_STORAGE_KEY");
});
