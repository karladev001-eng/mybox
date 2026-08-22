import assert from "node:assert/strict";
import test from "node:test";
import { LOCAL_PROFILE_ID } from "../src/core/account-identity.js";
import { AppHost } from "../src/core/app-host.js";
import { MemoryStorageDriver } from "../src/core/storage.js";
import { createKnowledgeApp } from "../src/knowledge/app.js";

const user = { type: "user", id: LOCAL_PROFILE_ID };

test("exports classified tagged Pages and idempotently consumes generated images", async () => {
  let imported = 0;
  const resources = { import: async () => { imported += 1; return { appId: "knowledge", resourceId: "copied.png", mediaType: "image/png", revision: 1 }; } };
  const host = new AppHost({ storageDriver: new MemoryStorageDriver(), resources });
  host.register(createKnowledgeApp());
  const project = (await host.invoke("knowledge.project.create", { name: "Images" }, { actor: user })).project;
  let page = (await host.invoke("knowledge.page.create", { projectId: project.id, title: "水彩の街" }, { actor: user })).page;
  page = (await host.invoke("knowledge.page.update", { projectId: project.id, pageId: page.id, expectedRevision: page.revision, mutation: { type: "markdown-set", markdown: "透明感のある水彩で描く", mode: "replace" } }, { actor: user })).page;
  page = (await host.invoke("knowledge.page.update", { projectId: project.id, pageId: page.id, expectedRevision: page.revision, mutation: { type: "tags-set", labels: ["image-public", "style"] } }, { actor: user })).page;

  const fragments = await host.invoke("knowledge.prompt-fragments.list", { config: { projectId: project.id, publishTag: "image-public", worldTag: "world", styleTag: "style", compositionTag: "composition", moodTag: "mood" } }, { actor: { type: "app", id: "image-studio" }, grant: { operationIds: ["knowledge.prompt-fragments.list"] } });
  assert.deepEqual(fragments.items.map(({ name, category, prompt }) => ({ name, category, prompt })), [{ name: "水彩の街", category: "style", prompt: "透明感のある水彩で描く" }]);

  const delivery = { item: { generationId: "generation-12345678", finalPrompt: "主題: 夜の街", selections: { style: "style-watercolor" }, ratio: "16:9", width: 1536, height: 864, createdAt: "2026-08-22T10:00:00.000Z", resource: { appId: "image-studio", resourceId: "source.png", mediaType: "image/png", revision: 1 } }, config: { projectId: project.id, pageTag: "generated" }, deliveryId: "connection:event-1", source: { appId: "image-studio" } };
  const callOptions = { actor: { type: "flow", id: "connection" }, grant: { operationIds: ["knowledge.generated-image.consume"] }, confirmationLevel: "recoverable" };
  const first = await host.invoke("knowledge.generated-image.consume", delivery, callOptions);
  const second = await host.invoke("knowledge.generated-image.consume", delivery, callOptions);
  assert.equal(first.duplicate, false); assert.equal(second.duplicate, true); assert.equal(first.pageId, second.pageId); assert.equal(imported, 1);
  const created = (await host.invoke("knowledge.page.read", { projectId: project.id, pageId: first.pageId }, { actor: user })).page;
  assert.equal(created.blocks[0].type, "image"); assert.equal(created.blocks[0].text, "copied.png");
  assert.match(JSON.stringify(created.blocks), /style-watercolor/);
});
