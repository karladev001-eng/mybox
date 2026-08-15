import assert from "node:assert/strict";
import test from "node:test";
import { APP_SCHEMA_VERSION, defineApp } from "../src/core/app-contract.js";
import { AppHost } from "../src/core/app-host.js";
import { createAppStorage, MemoryStorageDriver } from "../src/core/storage.js";

const noteSchema = {
  type: "object",
  required: ["id", "title", "content", "revision"],
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    content: { type: "string" },
    revision: { type: "integer", minimum: 1 },
  },
};

function createNotesApp() {
  return defineApp({
    manifest: {
      schemaVersion: APP_SCHEMA_VERSION,
      id: "notes",
      name: "メモ",
      version: "0.1.0",
      hostCapabilities: ["app-storage"],
      operations: [
        {
          id: "notes.create",
          title: "メモを作成",
          effect: "write",
          callers: ["user", "agent", "flow"],
          inputSchema: {
            type: "object",
            required: ["id", "title", "content"],
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              content: { type: "string" },
            },
          },
          outputSchema: noteSchema,
        },
        {
          id: "notes.read",
          title: "メモを読む",
          effect: "read",
          callers: ["user", "agent", "flow", "app"],
          inputSchema: {
            type: "object",
            required: ["id"],
            additionalProperties: false,
            properties: { id: { type: "string" } },
          },
          outputSchema: {
            anyOf: [noteSchema, { type: "null" }],
          },
        },
      ],
      events: [
        {
          id: "notes.created",
          title: "メモが作成された",
          payloadSchema: {
            type: "object",
            required: ["id", "revision"],
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              revision: { type: "integer" },
            },
          },
        },
      ],
    },
    handlers: {
      async "notes.create"(input, { storage, emit }) {
        const note = { ...input, revision: 1 };
        await storage.writeJson(`notes/${input.id}.json`, note);
        await emit("notes.created", { id: input.id, revision: note.revision });
        return note;
      },
      async "notes.read"({ id }, { storage }) {
        return storage.readJson(`notes/${id}.json`);
      },
    },
  });
}

function createSlidesApp() {
  return defineApp({
    manifest: {
      schemaVersion: APP_SCHEMA_VERSION,
      id: "slides",
      name: "スライド",
      version: "0.1.0",
      hostCapabilities: ["app-storage"],
      operations: [
        {
          id: "slides.generate",
          title: "スライドを生成",
          effect: "write",
          callers: ["user", "agent", "flow"],
          inputSchema: {
            type: "object",
            required: ["id", "source"],
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              source: noteSchema,
            },
          },
          outputSchema: {
            type: "object",
            required: ["id", "sourceRef"],
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              sourceRef: {
                type: "object",
                required: ["appId", "resourceId", "revision"],
                additionalProperties: false,
                properties: {
                  appId: { const: "notes" },
                  resourceId: { type: "string" },
                  revision: { type: "integer" },
                },
              },
            },
          },
        },
      ],
      events: [],
    },
    handlers: {
      async "slides.generate"({ id, source }, { storage }) {
        const result = {
          id,
          sourceRef: { appId: "notes", resourceId: source.id, revision: source.revision },
        };
        await storage.writeJson(`slides/${id}.json`, result);
        return result;
      },
    },
  });
}

test("routes validated operations and publishes immutable event envelopes", async () => {
  const host = new AppHost();
  host.register(createNotesApp());

  const events = [];
  host.subscribe("notes.created", async (event) => events.push(event));
  host.subscribe("notes.created", async () => {
    throw new Error("subscriber failure must not roll back the operation");
  });

  const note = await host.invoke("notes.create", {
    id: "note-1",
    title: "構想",
    content: "このメモからスライドを作る",
  });

  assert.equal(note.revision, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "notes.created");
  assert.equal(events[0].sourceAppId, "notes");
  assert.deepEqual(events[0].payload, { id: "note-1", revision: 1 });
});

test("allows an agent to read and write only with scoped grants and approval", async () => {
  const audit = [];
  const host = new AppHost({ audit: async (entry) => audit.push(entry) });
  host.register(createNotesApp());
  host.register(createSlidesApp());
  await host.invoke("notes.create", { id: "note-1", title: "構想", content: "要点" });

  const agent = { type: "agent", id: "assistant" };
  const note = await host.invoke("notes.read", { id: "note-1" }, {
    actor: agent,
    grant: { operationIds: ["notes.read"] },
    reason: "スライドの入力を取得",
  });
  assert.equal(note.title, "構想");

  await assert.rejects(
    host.invoke("slides.generate", { id: "deck-1", source: note }, {
      actor: agent,
      grant: { operationIds: ["slides.generate"] },
    }),
    (error) => error.code === "APPROVAL_REQUIRED",
  );

  const slide = await host.invoke("slides.generate", { id: "deck-1", source: note }, {
    actor: agent,
    grant: { operationIds: ["slides.generate"], allowWrites: true },
    reason: "選択したメモからスライドを生成",
  });
  assert.deepEqual(slide.sourceRef, { appId: "notes", resourceId: "note-1", revision: 1 });
  assert.equal(audit.at(-1).outcome, "succeeded");
  assert.equal(audit.at(-1).actor.type, "agent");
  assert.equal("input" in audit.at(-1), false);
  assert.equal("output" in audit.at(-1), false);
});

test("validates payloads and removes capabilities", async () => {
  const host = new AppHost();
  host.register(createNotesApp());
  host.register(createSlidesApp());

  await assert.rejects(
    host.invoke("notes.create", { id: "missing-fields" }),
    (error) => error.code === "INVALID_OPERATION_INPUT",
  );

  await host.invoke("notes.create", { id: "private", title: "非公開", content: "app-owned" });
  const generated = await host.invoke("slides.generate", {
    id: "deck-private",
    source: { id: "private", title: "非公開", content: "app-owned", revision: 1 },
  });
  assert.equal(generated.id, "deck-private");

  assert.equal(host.unregister("notes"), true);
  assert.equal(host.listOperations().some(({ id }) => id.startsWith("notes.")), false);
  await assert.rejects(
    host.invoke("notes.read", { id: "private" }),
    (error) => error.code === "OPERATION_NOT_FOUND",
  );
});

test("isolates app storage namespaces and rejects traversal attempts", async () => {
  const driver = new MemoryStorageDriver();
  const notesStorage = createAppStorage("notes", driver);
  const slidesStorage = createAppStorage("slides", driver);
  await notesStorage.writeJson("private.json", { owner: "notes" });
  assert.deepEqual(await notesStorage.readJson("private.json"), { owner: "notes" });
  assert.equal(await slidesStorage.readJson("private.json"), null);

  const app = defineApp({
    manifest: {
      schemaVersion: APP_SCHEMA_VERSION,
      id: "unsafe",
      name: "Unsafe fixture",
      version: "0.1.0",
      operations: [{
        id: "unsafe.write",
        title: "Unsafe write",
        effect: "write",
        callers: ["user"],
        inputSchema: { type: "object" },
        outputSchema: { type: "null" },
      }],
      events: [],
    },
    handlers: {
      async "unsafe.write"(_input, { storage }) {
        await storage.writeJson("../notes/private.json", { leaked: true });
        return null;
      },
    },
  });
  const host = new AppHost();
  host.register(app);

  await assert.rejects(
    host.invoke("unsafe.write", {}),
    (error) => error.code === "INVALID_STORAGE_KEY",
  );
});
