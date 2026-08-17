import assert from "node:assert/strict";
import test from "node:test";
import { createSyncClient, syncUrl } from "../src/knowledge/sync-client.js";
import {
  applyPageMutation,
  applyUpdate,
  createProjectDoc,
  encodeState,
  readPage,
  seedPage,
} from "../src/knowledge/yjs-document.js";

const PAGE = Object.freeze({
  id: "page-1",
  title: "Shared",
  state: "active",
  tagIds: [],
  blocks: [{ id: "block-1", type: "paragraph", text: "", checked: false, links: [] }],
});

const toBase64 = (bytes) => Buffer.from(bytes).toString("base64");

/** A socket that records what was sent and lets a test push messages back. */
function fakeSocket() {
  const sent = [];
  const socket = {
    readyState: 1,
    sent,
    send: (payload) => sent.push(JSON.parse(payload)),
    close() { socket.readyState = 3; socket.onclose?.(); },
    receive(message) { socket.onmessage?.({ data: JSON.stringify(message) }); },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  return socket;
}

function connected({ role = "editor", serverDoc = createProjectDoc(), ...options } = {}) {
  const doc = createProjectDoc();
  const socket = fakeSocket();
  const events = { status: [], awareness: [], errors: [] };
  const client = createSyncClient({
    doc,
    endpoint: "https://sync.test",
    projectId: "project-1",
    token: "token-1",
    openSocket: () => socket,
    onStatus: (state) => events.status.push(state.status),
    onAwareness: (state) => events.awareness.push(state),
    onError: (error) => events.errors.push(error.message),
    reconnect: false,
    ...options,
  });
  client.connect();
  socket.onopen?.();
  socket.receive({ type: "sync", role, update: toBase64(encodeState(serverDoc)) });
  return { doc, socket, client, events };
}

test("builds a websocket URL carrying the Project and token", () => {
  assert.equal(
    syncUrl("https://sync.example.workers.dev", "project-1", "abc"),
    "wss://sync.example.workers.dev/projects/project-1/sync?token=abc",
  );
  assert.equal(
    syncUrl("http://127.0.0.1:8787/", "a b", "t"),
    "ws://127.0.0.1:8787/projects/a%20b/sync?token=t",
  );
});

test("adopts the server's state and reports the granted role", () => {
  const serverDoc = createProjectDoc();
  seedPage(serverDoc, PAGE);
  const { doc, client, events } = connected({ serverDoc });

  assert.equal(readPage(doc, PAGE.id).title, "Shared");
  assert.equal(client.role, "editor");
  assert.deepEqual(events.status, ["connecting", "connected"]);
});

test("sends what was written offline once the server answers", () => {
  const doc = createProjectDoc();
  seedPage(doc, PAGE);
  const socket = fakeSocket();
  const client = createSyncClient({
    doc,
    endpoint: "https://sync.test",
    projectId: "p",
    token: "t",
    openSocket: () => socket,
    reconnect: false,
  });
  client.connect();
  socket.onopen?.();

  applyPageMutation(doc, PAGE.id, { type: "block-update", blockId: "block-1", text: "written offline" });
  assert.equal(socket.sent.length, 0, "nothing is sent before the handshake");

  socket.receive({ type: "sync", role: "editor", update: toBase64(encodeState(createProjectDoc())) });

  const pushed = socket.sent.at(-1);
  assert.equal(pushed.type, "update");

  // What was pushed must be enough for the server to reconstruct the Page.
  const server = createProjectDoc();
  applyUpdate(server, new Uint8Array(Buffer.from(pushed.update, "base64")));
  assert.equal(readPage(server, PAGE.id).blocks[0].text, "written offline");
});

test("a local edit is sent, and a relayed edit is never echoed back", () => {
  const { doc, socket } = connected();
  const sentAfterHandshake = socket.sent.length;

  const peer = createProjectDoc();
  seedPage(peer, PAGE);
  socket.receive({ type: "update", update: toBase64(encodeState(peer)) });
  assert.equal(readPage(doc, PAGE.id).title, "Shared", "the relayed Page arrived");
  assert.equal(socket.sent.length, sentAfterHandshake, "relaying it back would loop the room forever");

  applyPageMutation(doc, PAGE.id, { type: "block-update", blockId: "block-1", text: "typed here" });
  assert.equal(socket.sent.length, sentAfterHandshake + 1, "a local edit is sent once");
  assert.equal(socket.sent.at(-1).type, "update");
});

test("a viewer receives edits but sends none", () => {
  const serverDoc = createProjectDoc();
  seedPage(serverDoc, PAGE);
  const { doc, socket, client } = connected({ role: "viewer", serverDoc });
  assert.equal(readPage(doc, PAGE.id).title, "Shared", "the viewer still gets the Page");

  assert.equal(client.role, "viewer");
  assert.equal(socket.sent.length, 0, "a viewer does not push its state");

  applyPageMutation(doc, PAGE.id, { type: "block-update", blockId: "block-1", text: "attempt" });
  assert.equal(socket.sent.length, 0, "and does not spend a round trip being refused");
});

test("relays presence without writing it into the document", () => {
  const { socket, client, events, doc } = connected();
  client.sendAwareness({ cursor: 4 });
  assert.deepEqual(socket.sent.at(-1), { type: "awareness", state: { cursor: 4 } });

  socket.receive({ type: "awareness", profileId: "github:2", state: { cursor: 9 } });
  assert.deepEqual(events.awareness.at(-1), { profileId: "github:2", state: { cursor: 9 } });

  socket.receive({ type: "left", profileId: "github:2" });
  assert.deepEqual(events.awareness.at(-1), { profileId: "github:2", state: null });
  assert.equal(readPage(doc, PAGE.id), null, "presence never became document content");
});

test("surfaces a server refusal instead of failing silently", () => {
  const { socket, events } = connected();
  socket.receive({ type: "error", error: "ROLE_READ_ONLY" });
  assert.deepEqual(events.errors, ["ROLE_READ_ONLY"]);

  socket.onmessage({ data: "not json" });
  assert.equal(events.errors.at(-1), "MALFORMED_SERVER_MESSAGE");
});

test("a dropped connection retries with growing delays", () => {
  const delays = [];
  const socket = fakeSocket();
  const client = createSyncClient({
    doc: createProjectDoc(),
    endpoint: "https://sync.test",
    projectId: "p",
    token: "t",
    openSocket: () => socket,
    setTimer: (fn, ms) => { delays.push(ms); return delays.length; },
    clearTimer: () => {},
  });
  client.connect();
  socket.close();
  socket.close();
  assert.deepEqual(delays, [1000, 2000]);
  client.disconnect();
});

test("disconnecting stops sending and stops retrying", () => {
  const delays = [];
  const serverDoc = createProjectDoc();
  seedPage(serverDoc, PAGE);
  const { doc, socket, client } = connected({
    serverDoc,
    setTimer: (fn, ms) => { delays.push(ms); return delays.length; },
  });
  client.disconnect();
  const sentBefore = socket.sent.length;

  applyPageMutation(doc, PAGE.id, { type: "block-update", blockId: "block-1", text: "after close" });
  assert.equal(socket.sent.length, sentBefore, "a closed client sends nothing");
  assert.deepEqual(delays, [], "and schedules no reconnect");
});
