import { createFolder, moveToFolder, importFile, verifyFile, flattenLibrary } from "../src/knowledge/library.js";
import { reloadHostDefinitions } from "../vite.config.mjs";
import { reconcileRecordLinks, recordPageLinks, isRecordLinkBlock } from "../src/knowledge/record-links.js";
import { getBacklinks, movePageToTrash, restorePage } from "../src/knowledge/domain.js";
import test from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { createKnowledgeState, createProject, createPage, updatePage, readPage, searchPages } from "../src/knowledge/domain.js";
import { saveConversation, captureContext, finishContext, extractRecord } from "../src/knowledge/records.js";
import { createProjectDoc, commitRecordPage, readPage as readDocumentPage, applyPageMutation } from "../src/knowledge/yjs-document.js";
import { createKnowledgeClient, readPageWithRecordLinks } from "../src/knowledge/client.js";
import { createKnowledgeChatStore } from "../src/core/knowledge-chat-store.js";
import { createChatHistoryStore, normalizeChatHistory, appendChatMessage, buildConversationInput } from "../src/core/chat-history.js";
import { MemoryStorageDriver, createAppStorage } from "../src/core/storage.js";
import { AgentRuntime } from "../src/core/agent-runtime.js";
import { contextConversationLink, captureNotebook, ensureNotebook, finishNotebookTurn, notebookTurns, sharePreview, copySharedRecord } from "../src/knowledge/context-records.js";
import { createProfilePreferencesStore, createDefaultProfilePreferences } from "../src/core/profile-preferences.js";
import { AppHost } from "../src/core/app-host.js";
import { createSharedProject } from "../src/knowledge/shared-project.js";
import { withProjectSessions } from "../src/knowledge/record-operations.js";
import { createSyncClient } from "../src/knowledge/sync-client.js";

test("Context recording defaults on for legacy preferences, persists off, and failed writes do not change it", async () => {
  let value = { schemaVersion: 1, confirmationLevel: "review" }, fail = false;
  const store = createProfilePreferencesStore({ readJson: async () => value, writeJson: async (_, next) => { if (fail) throw new Error("disk full"); value = next; } });
  assert.equal((await store.load()).contextAutoRecord, true);
  assert.equal(createDefaultProfilePreferences().contextAutoRecord, true);
  await store.setContextAutoRecord(await store.load(), false);
  assert.equal((await store.load()).contextAutoRecord, false);
  fail = true;
  await assert.rejects(store.setContextAutoRecord(await store.load(), true), /disk full/);
  assert.equal((await store.load()).contextAutoRecord, false);
});

function notebookFixture() {
  let { state, projectId, page } = fixture();
  const added = createProject(state, { name: "Record" }); state = added.state;
  const note = createPage(state, { projectId, title: "Referenced Note" }); state = note.state;
  const input = { projectId: added.project.id, conversationProjectId: projectId, conversationId: page.id, contextId: "notebook", messageId: "message-0", callId: "call-a", prompt: "exact payload", settings: { model: "model", history: [{ id: "message-0", text: "記録 0" }] }, sources: [{ projectId, pageId: note.page.id, text: "" }] };
  return { state, input, note, conversation: page };
}

test("Context session links resolve existing records, follow renames and do not grant source access", () => {
  const { state, input } = notebookFixture();
  const recorded = captureNotebook(state, input, "local-user");
  const query = { projectId: input.projectId, pageId: input.contextId };
  const expected = { projectId: input.conversationProjectId, pageId: input.conversationId, title: "会話", available: true };
  assert.deepEqual(contextConversationLink(recorded.state, query, "local-user"), expected);
  const source = recorded.state.pages.find((p) => p.id === input.conversationId);
  source.title = "新しい会話名";
  assert.equal(contextConversationLink(recorded.state, query, "local-user").title, source.title);
  source.state = "trash";
  assert.equal(contextConversationLink(recorded.state, query, "local-user").available, false);
  source.state = "active";
  recorded.state.projects.find((p) => p.id === input.conversationProjectId).members = [];
  assert.deepEqual(contextConversationLink(recorded.state, query, "local-user"), { ...expected, title: "元のセッション会話", available: false });
  const legacy = captureContext(state, { ...input, projectId: input.conversationProjectId, contextId: "legacy-link", sources: [] }, "local-user");
  assert.deepEqual(contextConversationLink(legacy.state, { projectId: input.conversationProjectId, pageId: "legacy-link" }, "local-user"), expected);
});

test("private notebook collects cross-Project input, retains completed turns and appends new turns", () => {
  let { state, input, note, conversation } = notebookFixture();
  state = captureNotebook(state, input, "local-user").state;
  const original = readPage(state, { projectId: input.projectId, pageId: "notebook" });
  state = updatePage(state, { projectId: note.page.projectId, pageId: note.page.id, expectedRevision: note.page.revision, mutation: { type: "block-update", blockId: note.page.blocks[0].id, text: "edited" } }).state;
  state = captureNotebook(state, { ...input, callId: "call-b", prompt: "tool observations" }, "local-user").state;
  state = finishNotebookTurn(state, { projectId: input.projectId, pageId: "notebook", messageId: input.messageId, status: "complete" }, "local-user").state;
  assert.throws(() => captureNotebook(state, { ...input, callId: "call-c" }, "local-user"), /Completed/);
  const saved = saveConversation(state, { projectId: conversation.projectId, session: { id: conversation.id, title: conversation.title, messages: [message(2)] } }, "local-user");
  const next = captureNotebook(saved.state, { ...input, messageId: "message-2", callId: "call-c", sources: [] }, "local-user");
  assert.equal(next.page.blocks.filter((b) => b.turn).length, 2);
  assert.deepEqual(next.page.blocks[0].turn.sources, original.blocks[0].turn.sources);
  assert.equal(next.page.blocks[0].turn.status, "complete");
  const doc = createProjectDoc(); commitRecordPage(doc, original); commitRecordPage(doc, next.page);
  assert.equal(readDocumentPage(doc, "notebook").blocks[0].turn.status, "complete");
  assert.equal(readDocumentPage(doc, "notebook").blocks.filter((b) => b.turn).length, 2);
});

test("Context enforces source read, destination write, immutable call settings and stale source checks", () => {
  const { state, input } = notebookFixture();
  assert.throws(() => captureNotebook(state, { ...input, sources: [{ ...input.sources[0], text: "stale" }] }, "local-user"), /changed/);
  const captured = captureNotebook(state, input, "local-user");
  assert.throws(() => ensureNotebook(captured.state, { ...input, contextId: "duplicate-notebook" }, "local-user"), /existing Context/);
  assert.throws(() => captureNotebook(captured.state, { ...input, settings: { changed: true } }, "local-user"), /cannot be changed/);
  state.projects.find((p) => p.id === input.projectId).members[0].role = "viewer";
  assert.throws(() => captureNotebook(state, input, "local-user"), /Editor/);
  state.projects.find((p) => p.id === input.projectId).members[0].role = "owner";
  state.projects.find((p) => p.id === input.conversationProjectId).members = [];
  assert.throws(() => captureNotebook(state, input, "local-user"), /role|member/i);
});

test("selective sharing freezes questions, answers and media, and detects stale previews", async () => {
  let { state, input } = notebookFixture();
  state.pages.find((p) => p.id === input.conversationId).blocks[1].message.image = { appId: "knowledge", resourceId: "answer.png", mediaType: "image/png", revision: 1 };
  state = captureNotebook(state, input, "local-user").state;
  state = finishNotebookTurn(state, { projectId: input.projectId, pageId: "notebook", messageId: input.messageId, status: "complete" }, "local-user").state;
  const target = createProject(state, { name: "Shared" }); state = target.state;
  const selection = { projectId: input.projectId, pageId: "notebook", targetProjectId: target.project.id, turnIds: ["turn-message-0"] };
  const preview = await sharePreview(state, selection, "local-user");
  const request = { ...selection, previewToken: preview.token, copyId: "shared-copy" };
  await assert.rejects(copySharedRecord(state, request, "local-user", { read: async () => { throw new Error("missing image"); } }), /missing image/);
  const result = await copySharedRecord(state, request, "local-user", { read: async () => "aGVsbG8=" });
  assert.equal(contextConversationLink(result.state, { projectId: target.project.id, pageId: result.page.id }, "local-user").pageId, input.conversationId);
  const turn = notebookTurns(result.state, { projectId: target.project.id, pageId: result.page.id }, "local-user")[0];
  assert.equal(turn.question, "記録 0"); assert.equal(turn.answers[0].content, "記録 1");
  assert.equal(turn.answers[0].image.dataUrl, "data:image/png;base64,aGVsbG8=");
  const doc = createProjectDoc(); commitRecordPage(doc, result.page);
  assert.equal(readDocumentPage(doc, result.page.id).blocks.find((b) => b.message).message.image.dataUrl, turn.answers[0].image.dataUrl);
  state.pages.find((p) => p.id === input.conversationId).blocks[1].text = "changed";
  await assert.rejects(copySharedRecord(state, request, "local-user", {}), /preview again/);
  assert.equal(turn.answers[0].content, "記録 1");
  state.projects.find((p) => p.id === target.project.id).members[0].role = "viewer";
  await assert.rejects(sharePreview(state, selection, "local-user"), /Editor/);
  assert.throws(() => updatePage(result.state, { projectId: target.project.id, pageId: result.page.id, expectedRevision: result.page.revision, mutation: { type: "block-update", blockId: result.page.blocks[0].id, text: "edit" } }), /変更できません/);
});

test("legacy Context Pages are linked idempotently without copying or deleting their Blocks", () => {
  let { state, input } = notebookFixture();
  const old = captureContext(state, { ...input, projectId: input.conversationProjectId, contextId: "old-context", sources: [] }, "local-user");
  state = old.state;
  const ensured = ensureNotebook(state, input, "local-user");
  const again = ensureNotebook(ensured.state, input, "local-user");
  assert.equal(again.page.context.legacy.length, 1);
  assert.equal(again.page.blocks.length, 0);
  assert.deepEqual(readPage(again.state, { projectId: input.conversationProjectId, pageId: "old-context" }), old.page);
  assert.equal(notebookTurns(again.state, { projectId: input.projectId, pageId: "notebook" }, "local-user")[0].legacy.pageId, "old-context");
});

test("Host reuses the notebook after restart, marks unfinished input unknown and replaces a shared Record destination", async () => {
  const client = createKnowledgeClient({ appRuntime: { host: new AppHost({ storageDriver: new MemoryStorageDriver() }), sharedSessions: new Map() } });
  const legacy = createChatHistoryStore(createAppStorage("ai-chat", new MemoryStorageDriver()));
  let endpoints = [];
  const port = { ...client, listSyncEndpoints: async () => endpoints, ensureAppProjectStore: async () => {} };
  const createStore = () => createKnowledgeChatStore({ client: port, legacy, desktop: true });
  const store = createStore(); await store.load();
  const history = await store.save({ version: 2, sessions: [{ id: "host-conversation", title: "Host", messages: [message(0)] }] });
  const conversation = history.sessions[0];
  const destination = await store.contextDestination(conversation.projectId, conversation.id);
  await store.capture({ ...destination, conversationProjectId: conversation.projectId, conversationId: conversation.id, messageId: "message-0", callId: "host-call", prompt: "exact" });
  const restarted = createStore(); await restarted.load();
  assert.deepEqual(await restarted.contextDestination(conversation.projectId, conversation.id), destination);
  const recorded = await client.invoke("knowledge.context.read.v2", { projectId: destination.projectId, pageId: destination.contextId });
  assert.equal(recorded.turns[0].status, "unknown");
  endpoints = [{ projectId: destination.projectId }];
  const replacement = await restarted.contextDestination(conversation.projectId, conversation.id);
  assert.notEqual(replacement.projectId, destination.projectId);
  assert.equal((await client.readPage(destination.projectId, destination.contextId)).page.id, destination.contextId);
});

const message = (i) => ({ id: `message-${i}`, role: i % 2 ? "assistant" : "user", content: `記録 ${i}`, createdAt: "2026-09-05T00:00:00Z", status: "complete" });
function fixture() {
  const initial = createKnowledgeState();
  const projectId = initial.projects[0].id;
  const session = { id: "conversation-1", title: "会話", createdAt: "2026-09-05T00:00:00Z", updatedAt: "2026-09-05T00:00:00Z", messages: [message(0), message(1)] };
  const result = saveConversation(initial, { projectId, session }, "local-user");
  return { ...result, projectId, session };
}

test("conversation records preserve identity, search, immutable text and extract provenance", () => {
  const { state, page, projectId, session } = fixture();
  assert.equal(searchPages(state, { query: "記録 1", projectIds: [projectId] })[0].blockId, "message-1");
  assert.throws(() => updatePage(state, { projectId, pageId: page.id, expectedRevision: page.revision, mutation: { type: "block-update", blockId: "message-1", text: "changed" } }), /変更できません/);
  assert.throws(() => saveConversation(state, { projectId, session: { ...session, messages: [{ ...message(0), content: "changed" }] } }, "local-user"), /cannot be edited/);
  const extracted = extractRecord(state, { projectId, pageId: page.id, blockId: "message-1" }, "local-user");
  assert.equal(extracted.page.kind, "note");
  assert.deepEqual(extracted.page.provenance.blockIds, ["message-1"]);
  assert.equal(extracted.page.blocks[0].text, "記録 1");
  assert.equal(state.pages.length, 1);
});

test("Context captures exact calls, stays fixed after source changes, rejects cross-Project and Viewer writes", () => {
  let { state, projectId, page } = fixture();
  const note = createPage(state, { projectId, title: "Source" }); state = note.state;
  const input = { projectId, conversationId: page.id, messageId: "message-0", contextId: "context-1", callId: "call-1", prompt: "exact\ninput", sources: [{ projectId, pageId: note.page.id }] };
  const captured = captureContext(state, input, "local-user");
  assert.equal(captured.page.blocks[0].text, "exact\ninput");
  const changed = updatePage(captured.state, { projectId, pageId: note.page.id, expectedRevision: note.page.revision, mutation: { type: "block-update", blockId: note.page.blocks[0].id, text: "later" } });
  assert.equal(readPage(changed.state, { projectId, pageId: "context-1" }).context.sources[0].blocks[0].text, "");
  assert.throws(() => captureContext(state, { ...input, sources: [{ projectId: "other", pageId: note.page.id }] }, "local-user"), /conversation Project/);
  const finished = finishContext(captured.state, { projectId, pageId: "context-1", status: "complete" }, "local-user");
  assert.throws(() => captureContext(finished.state, { ...input, callId: "call-2" }, "local-user"), /cannot be changed/);
  state.projects[0].members.push({ profileId: "viewer", role: "viewer" });
  assert.throws(() => captureContext(state, input, "viewer"), /Editor/);
});

test("Yjs round-trips record metadata and converges concurrent immutable message additions", () => {
  const { page } = fixture();
  const left = createProjectDoc(), right = createProjectDoc();
  commitRecordPage(left, page); Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
  assert.equal(readDocumentPage(right, page.id).kind, "conversation");
  assert.deepEqual(readDocumentPage(right, page.id).blocks[1].message, page.blocks[1].message);
  const a = structuredClone(page), b = structuredClone(page);
  a.blocks.push({ ...page.blocks[0], id: "left", text: "left" });
  b.blocks.push({ ...page.blocks[0], id: "right", text: "right" });
  commitRecordPage(left, a); commitRecordPage(right, b);
  Y.applyUpdate(left, Y.encodeStateAsUpdate(right)); Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
  assert.deepEqual(readDocumentPage(left, page.id), readDocumentPage(right, page.id));
  assert.equal(readDocumentPage(left, page.id).blocks.length, 4);
  assert.throws(() => applyPageMutation(left, page.id, { type: "block-update", blockId: "message-0", text: "bad" }), /IMMUTABLE/);
});

test("legacy migration keeps over 200 messages, duplicate titles, backup and idempotent cutover", async () => {
  const raw = { version: 2, sessions: [
    { id: "legacy-a", title: "Duplicate", customMetadata: { retained: true }, messages: Array.from({ length: 205 }, (_, i) => message(i)) },
    { id: "legacy-b", title: "Duplicate", messages: [{ ...message(0), status: "error", content: "failed" }] },
  ] };
  const driver = new MemoryStorageDriver();
  const storage = createAppStorage("ai-chat", driver); await storage.writeJson("sessions/index", raw);
  const legacy = createChatHistoryStore(storage);
  const client = createKnowledgeClient();
  const store = createKnowledgeChatStore({ client, legacy });
  const history = await store.load();
  assert.equal(history.sessions.find((s) => s.id === "legacy-a").messages.length, 205);
  assert.deepEqual(history.sessions.find((s) => s.id === "legacy-a").customMetadata, { retained: true });
  assert.deepEqual(await legacy.readBackup(), raw);
  assert.equal((await store.load()).sessions.length, 2);
  const a = history.sessions.find((s) => s.id === "legacy-a");
  const appended = appendChatMessage(history, a.id, { role: "user", content: "new" });
  const saved = await store.save(appended.history);
  assert.equal(saved.sessions.find((s) => s.id === a.id).messages.length, 206);
  assert.deepEqual(await legacy.readRaw(), raw);
  assert.equal(normalizeChatHistory({ version: 2, sessions: Array.from({ length: 105 }, (_, i) => ({ id: `s${i}`, title: "s", messages: [] })) }).sessions.length, 105);
});

test("bounded provider history records the exact adopted message identities and text", () => {
  const session = { messages: [message(0), { ...message(1), content: "x".repeat(100) }, { ...message(2), status: "error" }, message(4)] };
  const input = buildConversationInput(session, 30);
  assert.deepEqual(input.history.map((m) => m.id), ["message-4"]);
  assert.ok(input.prompt.endsWith(`User: ${input.history[0].text}`));
  assert.equal(session.messages[1].content.length, 100);
});

test("migration handles empty history and maps an ID already used in another Project", async () => {
  const isolatedClient = () => createKnowledgeClient({ appRuntime: { host: new AppHost({ storageDriver: new MemoryStorageDriver() }), sharedSessions: new Map() } });
  const client = isolatedClient();
  const { projects } = await client.listProjects();
  const { page } = await client.createPage(projects[0].id, "Existing Note");
  const storage = createAppStorage("ai-chat", new MemoryStorageDriver());
  const legacy = createChatHistoryStore(storage);
  await storage.writeJson("sessions/index", { version: 2, sessions: [{ id: page.id, title: "Collision", messages: [message(0)] }] });
  const store = createKnowledgeChatStore({ client, legacy });
  const history = await store.load();
  assert.equal(history.sessions.length, 1);
  assert.notEqual(history.sessions[0].id, page.id);
  assert.equal((await client.readPage(projects[0].id, page.id)).page.title, "Existing Note");
  assert.equal((await legacy.readMigration()).mappings[0].id, history.sessions[0].id);
  const emptyLegacy = createChatHistoryStore(createAppStorage("ai-chat", new MemoryStorageDriver()));
  const empty = createKnowledgeChatStore({ client: isolatedClient(), legacy: emptyLegacy });
  assert.equal((await empty.load()).sessions.length, 0);
  assert.equal((await emptyLegacy.readMigration()).phase, "complete");
});

test("Agent captures every exact request before provider execution and stops if persistence fails", async () => {
  const calls = [], saved = [];
  const host = { listOperations: () => [{ id: "read", title: "Read", effect: "read", confirmationClass: "review", inputSchema: {} }], invoke: async () => ({ text: "tool result" }) };
  const provider = { generate: async (request) => { assert.deepEqual(saved.at(-1), request); calls.push(request); return { data: calls.length === 1 ? { type: "invoke", operationId: "read", input: {} } : { type: "respond", message: "done" } }; } };
  await new AgentRuntime({ host, providers: { get: () => provider } }).run("goal", { onModelRequest: async (request) => saved.push(structuredClone(request)) });
  assert.equal(calls.length, 2); assert.match(saved[1].prompt, /tool result/);
  await assert.rejects(new AgentRuntime({ host, providers: { get: () => provider } }).run("goal", { onModelRequest: async () => { throw new Error("disk full"); } }), /disk full/);
  assert.equal(calls.length, 2);
});

test("live Project search includes immutable records and effective Viewer roles", () => {
  const { state, page, projectId } = fixture();
  let role = "owner";
  const shared = createSharedProject({ projectId, createClient: () => ({ get role() { return role; }, connect() {}, disconnect() {}, sendAwareness() {} }) });
  shared.commitRecord(page);
  const sessions = new Map([[projectId, shared]]);
  const projection = withProjectSessions(state, sessions, "local-user");
  assert.equal(searchPages(projection, { query: "記録", projectIds: [projectId] }).length, 2);
  role = "viewer";
  assert.throws(() => shared.commitRecord(page), /Editor/);
  assert.throws(() => shared.mutate(page.id, { type: "rename", title: "bad" }), /Editor/);
  shared.dispose();
});

test("missing legacy media stops cutover; retry resumes from preserved identity mappings", async () => {
  const driver = new MemoryStorageDriver();
  const storage = createAppStorage("ai-chat", driver);
  const raw = { version: 2, sessions: [{ id: `image-${crypto.randomUUID()}`, title: "Media", messages: [{ ...message(1), image: { resourceId: "missing.png", mediaType: "image/png" } }] }] };
  await storage.writeJson("sessions/index", raw);
  const legacy = createChatHistoryStore(storage);
  const client = createKnowledgeClient();
  let available = false;
  const data = "data:image/png;base64,aGVsbG8=";
  const store = createKnowledgeChatStore({ client: { ...client, storeImageBytes: async () => "copied.png", readImage: async () => data }, legacy, readLegacyImage: async () => { if (!available) throw new Error("missing media"); return data; } });
  await assert.rejects(store.load(), /missing media/);
  assert.equal((await legacy.readMigration()).phase, "pending");
  assert.deepEqual(await legacy.readBackup(), raw);
  const mapping = (await legacy.readMigration()).mappings[0].id;
  available = true;
  const history = await store.load();
  const session = history.sessions.find((s) => s.id === mapping);
  assert.equal(session.messages[0].image.appId, "knowledge");
  assert.equal((await legacy.readMigration()).phase, "complete");
});

test("sync refuses a legacy server before applying or transmitting record state", () => {
  const doc = createProjectDoc();
  const writes = [], errors = [];
  const socket = { readyState: 1, send: (v) => writes.push(v), close() {} };
  const client = createSyncClient({ doc, endpoint: "https://example.test", projectId: "p", token: "test", openSocket: (url) => { assert.equal(new URL(url).searchParams.get("records"), "4"); return socket; }, onError: (e) => errors.push(e), reconnect: false });
  client.connect();
  socket.onmessage({ data: JSON.stringify({ type: "sync", role: "owner", update: Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64") }) });
  assert.equal(writes.length, 0); assert.equal(client.status, "incompatible"); assert.equal(errors.length, 1);
  client.disconnect();
});




test("automatic PageLinks persist reciprocally, repair old records once, and survive Trash without rewriting inputs", () => {
  let { state, input } = notebookFixture();
  input = { ...input, projectId: input.conversationProjectId };
  state = captureNotebook(state, input, "local-user").state;
  const query = { projectId: input.projectId, pageId: input.contextId };
  const before = structuredClone(state.pages.find((p) => p.id === input.contextId).blocks);
  state = reconcileRecordLinks(state, query, "local-user").state;
  const context = state.pages.find((p) => p.id === input.contextId);
  assert.deepEqual(context.blocks.filter((b) => !isRecordLinkBlock(b)), before);
  assert.equal(getBacklinks(state, query).some((b) => b.pageId === input.conversationId), true);
  assert.equal(recordPageLinks(state, query, "local-user").some((link) => link.pageId === input.conversationId), true);
  assert.deepEqual(reconcileRecordLinks(state, query, "local-user").state, state);
  const doc = createProjectDoc();
  commitRecordPage(doc, context); commitRecordPage(doc, context);
  assert.deepEqual(readDocumentPage(doc, context.id).blocks.map((b) => b.links), context.blocks.map((b) => b.links));
  state = movePageToTrash(state, { projectId: input.projectId, pageId: input.conversationId, expectedRevision: state.pages.find((p) => p.id === input.conversationId).revision }).state;
  assert.equal(recordPageLinks(state, query, "local-user").some((link) => link.pageId === input.conversationId), false);
  assert.deepEqual(state.pages.find((p) => p.id === input.contextId).blocks, context.blocks);
  state = restorePage(state, { projectId: input.projectId, pageId: input.conversationId, expectedRevision: state.pages.find((p) => p.id === input.conversationId).revision }).state;
  assert.equal(recordPageLinks(state, query, "local-user").some((link) => link.pageId === input.conversationId), true);
});

test("cross-Project record backlinks respect read access and never modify the source Project", () => {
  let { state, input } = notebookFixture();
  state = captureNotebook(state, input, "local-user").state;
  const original = structuredClone(state.pages.find((p) => p.id === input.conversationId));
  state = reconcileRecordLinks(state, { projectId: input.projectId, pageId: input.contextId }, "local-user").state;
  const query = { projectId: input.conversationProjectId, pageId: input.conversationId };
  assert.deepEqual(state.pages.find((p) => p.id === input.conversationId), original);
  assert.equal(getBacklinks(state, query).some((link) => link.pageId === input.contextId && link.projectId === input.projectId), true);
  state.projects.find((p) => p.id === input.projectId).members = [];
  assert.deepEqual(getBacklinks(state, query), []);
});

test("Host persists automatic PageLinks for new records and rejects Viewer repair", async () => {
  const storageDriver = new MemoryStorageDriver();
  const makeClient = () => createKnowledgeClient({ appRuntime: { host: new AppHost({ storageDriver }), sharedSessions: new Map() } });
  let client = makeClient();
  const { projects } = await client.listProjects();
  const projectId = projects[0].id;
  await client.invoke("knowledge.conversation.save.v1", { projectId, session: { id: "linked-chat", title: "Linked chat", messages: [message(0)] } });
  await client.invoke("knowledge.context.capture.v2", { projectId, conversationProjectId: projectId, conversationId: "linked-chat", contextId: "linked-context", messageId: "message-0", callId: "linked-call", prompt: "exact input" });
  client = makeClient();
  const context = await client.readPage(projectId, "linked-context");
  const conversation = await client.readPage(projectId, "linked-chat");
  assert.equal(context.backlinks[0].pageId, "linked-chat");
  assert.equal(conversation.backlinks[0].pageId, "linked-context");
  assert.equal(conversation.pageLinks[0].pageId, "linked-context");
  await client.invoke("knowledge.record.links.v1", { projectId, pageId: "linked-context" });
  assert.deepEqual((await client.readPage(projectId, "linked-context")).page.blocks, context.page.blocks);
  const storage = createAppStorage("knowledge", storageDriver);
  const saved = await storage.readJson("state.json");
  saved.projects[0].members[0].role = "viewer";
  await storage.writeJson("state.json", saved);
  await assert.rejects(client.invoke("knowledge.record.links.v1", { projectId, pageId: "linked-context" }), (error) => error.code === "PROJECT_ROLE_REQUIRED");
  assert.equal((await client.readPage(projectId, "linked-context")).backlinks.length, 1);
});


test("opening a Page tolerates a retained older Host but does not hide persistence or read errors", async () => {
  const result = { page: { id: "existing" }, backlinks: [] };
  for (const code of ["OPERATION_NOT_FOUND", "PROJECT_ROLE_REQUIRED"]) {
    let reads = 0;
    const client = { invoke: async () => { throw Object.assign(new Error("Operation is unavailable"), { code }); }, readPage: async () => { reads++; return result; } };
    assert.equal(await readPageWithRecordLinks(client, "project", "existing"), result);
    assert.equal(reads, 1);
  }
  const diskError = new Error("disk full");
  await assert.rejects(readPageWithRecordLinks({ invoke: async () => { throw diskError; }, readPage: async () => assert.fail("must surface repair failure") }, "project", "existing"), diskError);
  const denied = Object.assign(new Error("No access"), { code: "PROJECT_ROLE_REQUIRED" });
  await assert.rejects(readPageWithRecordLinks({ invoke: async () => {}, readPage: async () => { throw denied; } }, "project", "existing"), denied);
  const calls = [];
  assert.equal(await readPageWithRecordLinks({ invoke: async (id) => calls.push(id), readPage: async () => { calls.push("read"); return result; } }, "project", "existing"), result);
  assert.deepEqual(calls, ["knowledge.library.flatten.v1", "knowledge.record.links.v1", "read"]);
});


test("development updates reload retained Host definitions while UI-only refresh stays lightweight", () => {
  const sent = [];
  const server = { ws: { send: (event) => sent.push(event) } };
  const plugin = reloadHostDefinitions();
  for (const file of ["/workspace/src/knowledge/record-operations.js", "C:\\workspace\\src\\core\\app-runtime.js", "/workspace/src/knowledge/app.js", "/workspace/src/knowledge/client.js"]) {
    assert.deepEqual(plugin.handleHotUpdate({ file, server }), []);
  }
  assert.equal(sent.length, 4);
  assert.deepEqual(sent[0], { type: "full-reload", path: "*" });
  for (const file of ["/workspace/src/knowledge/KnowledgeView.jsx", "/workspace/src/styles.css"]) assert.equal(plugin.handleHotUpdate({ file, server }), undefined);
  assert.equal(sent.length, 4);
});


test("Folders preserve Page IDs and enforce hierarchy, Project boundaries and empty Trash", () => {
  let { state, projectId, page } = fixture();
  const parent = createFolder(state, { projectId, title: "資料" }, "local-user"); state = parent.state;
  const child = createFolder(state, { projectId, title: "下書き", folderId: parent.page.id }, "local-user"); state = child.state;
  state = moveToFolder(state, { projectId, pageId: page.id, folderId: child.page.id }, "local-user").state;
  assert.equal(state.pages.find((p) => p.id === page.id).folderId, child.page.id);
  assert.throws(() => moveToFolder(state, { projectId, pageId: parent.page.id, folderId: child.page.id }, "local-user"), /自身/);
  assert.throws(() => movePageToTrash(state, { projectId, pageId: parent.page.id, expectedRevision: parent.page.revision }), /Folder内/);
  const other = createProject(state, { name: "Other" });
  assert.throws(() => moveToFolder(other.state, { projectId: other.project.id, pageId: page.id, folderId: parent.page.id }, "local-user"), /Page/);
  state.projects[0].members[0].role = "viewer";
  assert.throws(() => moveToFolder(state, { projectId, pageId: page.id }, "local-user"), /Editor/);
});

test("File import verifies originals, remains immutable, retries without duplication and survives restart", async () => {
  const driver = new MemoryStorageDriver();
  const make = () => createKnowledgeClient({ appRuntime: { host: new AppHost({ storageDriver: driver }), sharedSessions: new Map() } });
  let client = make();
  const { projects } = await client.listProjects(); const projectId = projects[0].id;
  const input = { projectId, fileId: "file-test", name: "資料.pdf", base64: btoa("%PDF-1.7 sample original") };
  const { page } = await client.invoke("knowledge.file.import.v1", input);
  assert.equal(page.file.mediaType, "application/pdf");
  assert.equal((await client.invoke("knowledge.file.import.v1", input)).page.id, page.id);
  client = make();
  assert.equal((await client.invoke("knowledge.file.read.v1", { projectId, pageId: page.id })).base64, input.base64);
  assert.equal((await client.search({ query: "資料" })).results[0].pageId, page.id);
  await assert.rejects(client.updatePage(projectId, page.id, page.revision, { type: "block-add", text: "replacement" }), /変更できません/);
  await assert.rejects(client.invoke("knowledge.file.import.v1", { ...input, base64: btoa("other") }), /ID/);
  await assert.rejects(verifyFile(input.base64, "wrong"), /照合/);
  const doc = createProjectDoc(); commitRecordPage(doc, { ...page, folderId: "folder" });
  assert.equal(readDocumentPage(doc, page.id).file.hash, page.file.hash);
  assert.equal(readDocumentPage(doc, page.id).folderId, "folder");
  const storage = createAppStorage("knowledge", driver); const state = await storage.readJson("state.json"); state.projects[0].members[0].role = "viewer"; await storage.writeJson("state.json", state);
  await assert.rejects(client.invoke("knowledge.file.import.v1", { ...input, fileId: "other" }), /Editor/);
  assert.equal((await client.invoke("knowledge.file.read.v1", { projectId, pageId: page.id })).base64, input.base64);
});

test("failed original persistence never creates File metadata and magic bytes override the filename", async () => {
  const { state, projectId } = fixture();
  const input = { projectId, fileId: "file", name: "pretend.png", base64: btoa("not an image") };
  await assert.rejects(importFile(state, input, "local-user", null, { put: async () => { throw new Error("disk full"); } }), /disk full/);
  assert.equal(state.pages.some((p) => p.id === input.fileId), false);
  assert.equal((await verifyFile(input.base64)).mediaType, "application/octet-stream");
});


test("retired Folders become link Notes without losing children and repeat migration is a no-op", () => {
  let { state, projectId, page } = fixture();
  const folder = createFolder(state, { projectId, title: "Legacy folder" }, "local-user"); state = folder.state;
  state = moveToFolder(state, { projectId, pageId: page.id, folderId: folder.page.id }, "local-user").state;
  const input = { projectId, pageId: page.id };
  const result = flattenLibrary(state, input, "local-user");
  const converted = result.state.pages.find((p) => p.id === folder.page.id);
  assert.equal(converted.kind, "note");
  assert.equal(converted.blocks[0].links[0].targetPageId, page.id);
  assert.equal(result.page.folderId, null);
  assert.deepEqual(result.page.blocks, page.blocks);
  assert.deepEqual(flattenLibrary(result.state, input, "local-user").state, result.state);
  const doc = createProjectDoc(); commitRecordPage(doc, folder.page); commitRecordPage(doc, converted);
  assert.equal(readDocumentPage(doc, converted.id).kind, "note");
  assert.equal(readDocumentPage(doc, converted.id).blocks[0].links[0].targetPageId, page.id);
});

test("multi-term search ranks exact titles first and retains matching Block identity", () => {
  let { state, projectId } = fixture();
  const exact = createPage(state, { projectId, title: "設計 AI" }); state = exact.state;
  const body = createPage(state, { projectId, title: "別の記録" }); state = body.state;
  state = updatePage(state, { projectId, pageId: body.page.id, expectedRevision: body.page.revision, mutation: { type: "block-update", blockId: body.page.blocks[0].id, text: "AIを使った設計について" } }).state;
  const found = searchPages(state, { projectIds: [projectId], query: "設計 AI" });
  assert.equal(found[0].pageId, exact.page.id);
  assert.equal(found.find((r) => r.pageId === body.page.id).blockId, body.page.blocks[0].id);
});

test("outline preserves heading IDs, levels and duplicate titles without indexing code", async () => {
  const { pageHeadings } = await import("../src/knowledge/page-outline.js");
  assert.deepEqual(pageHeadings([{ id: "a", type: "heading-1", text: "同じ見出し" }, { id: "b", type: "code", text: "# not a heading" }, { id: "c", type: "heading-3", text: "同じ見出し" }]), [{ id: "a", level: 1, title: "同じ見出し" }, { id: "c", level: 3, title: "同じ見出し" }]);
});


test("aggregate projection reads one bulk snapshot and skips revoked sessions", () => {
  const stored = { projects: [{ id: "bulk", members: [] }], pages: [], tags: [] };
  let calls = 0;
  let role = "owner";
  const live = {
    get role() { return role; },
    readRecords() { calls++; return { pages: [{ id: "one", title: "One", projectId: "bulk", state: "active", blocks: [] }], tags: [] }; },
    listPages() { throw Error("per-Page hydration must not run"); },
    readPage() { throw Error("per-Page hydration must not run"); },
    listTags() { throw Error("second scan must not run"); },
  };
  const sessions = new Map([["bulk", live]]);
  assert.equal(withProjectSessions(stored, sessions, "user").pages.length, 1);
  assert.equal(calls, 1);
  assert.deepEqual(stored.pages, []);
  role = null;
  assert.equal(withProjectSessions(stored, sessions, "user").pages.length, 0);
  assert.equal(calls, 1);
});
