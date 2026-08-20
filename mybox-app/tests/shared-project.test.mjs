import assert from "node:assert/strict";
import test from "node:test";
import { createSharedProject } from "../src/knowledge/shared-project.js";

const PAGE = Object.freeze({
  id: "page-1",
  title: "Shared Page",
  state: "active",
  tagIds: [],
  blocks: [{ id: "block-1", type: "paragraph", text: "hello", checked: false, links: [] }],
});

/** Replaces the sync client so the session can be driven without a network. */
function stubClient() {
  const calls = { connected: 0, disconnected: 0, awareness: [] };
  let handlers = {};
  const factory = (options) => {
    handlers = options;
    return {
      connect: () => { calls.connected += 1; },
      disconnect: () => { calls.disconnected += 1; },
      sendAwareness: (state) => calls.awareness.push(state),
      get role() { return "editor"; },
    };
  };
  return { factory, calls, emit: () => handlers };
}

function session(extra = {}) {
  const stub = stubClient();
  const changes = [];
  const shared = createSharedProject({
    endpoint: "https://sync.test",
    projectId: "project-1",
    token: "token-1",
    createClient: stub.factory,
    onChange: () => changes.push(1),
    ...extra,
  });
  return { shared, stub, changes };
}

test("adopting local Pages puts them in the shared document once", () => {
  const { shared, changes } = session();
  shared.adopt([PAGE]);
  assert.deepEqual(shared.listPages().map((page) => page.id), ["page-1"]);
  assert.ok(changes.length > 0, "the view is told the document moved");

  shared.adopt([PAGE]);
  assert.deepEqual(shared.listPages().map((page) => page.id), ["page-1"], "re-adopting adds no duplicate");
});

test("reads a Page back in the shape the editor expects", () => {
  const { shared } = session();
  shared.adopt([PAGE]);
  const result = shared.readPage("page-1");

  assert.equal(result.page.title, "Shared Page");
  assert.equal(result.page.projectId, "project-1");
  assert.equal(result.page.blocks[0].text, "hello");
  assert.deepEqual(result.backlinks, []);
  assert.equal(shared.readPage("missing"), null);
});

test("a mutation changes the document and notifies the view", () => {
  const { shared, changes } = session();
  shared.adopt([PAGE]);
  const before = changes.length;

  shared.mutate("page-1", { type: "block-update", blockId: "block-1", text: "edited" });
  assert.equal(shared.readPage("page-1").page.blocks[0].text, "edited");
  assert.ok(changes.length > before, "an edit re-renders the editor");
});

test("backlinks are derived from the document rather than stored", () => {
  const { shared } = session();
  shared.adopt([
    PAGE,
    { id: "page-2", title: "Source", state: "active", tagIds: [], blocks: [
      { id: "block-9", type: "paragraph", text: "see [[Shared Page]]", checked: false,
        links: [{ targetPageId: "page-1", token: "[[Shared Page]]" }] },
    ] },
  ]);

  const backlinks = shared.readPage("page-1").backlinks;
  assert.equal(backlinks.length, 1);
  assert.equal(backlinks[0].pageId, "page-2");
  assert.equal(backlinks[0].pageTitle, "Source");
});

test("only active Pages are listed", () => {
  const { shared } = session();
  shared.adopt([PAGE]);
  shared.mutate("page-1", { type: "page-state", state: "trash" });
  assert.deepEqual(shared.listPages(), []);
});

test("presence is passed to the client and never becomes content", () => {
  const { shared, stub } = session();
  shared.adopt([PAGE]);
  shared.sendPresence({ cursor: 2 });

  assert.deepEqual(stub.calls.awareness, [{ cursor: 2 }]);
  assert.equal(shared.readPage("page-1").page.blocks[0].text, "hello");
});

test("publishes only the current actor's persistent account presentation", () => {
  const { shared } = session();
  assert.deepEqual(
    shared.setMemberProfile({ profileId: "github:42", displayName: "Kan", avatarUrl: null }, "github:42"),
    { profileId: "github:42", displayName: "Kan", avatarUrl: null },
  );
  assert.deepEqual(shared.listMemberProfiles(), [{ profileId: "github:42", displayName: "Kan", avatarUrl: null }]);
  assert.throws(
    () => shared.setMemberProfile({ profileId: "github:9", displayName: "Other", avatarUrl: null }, "github:42"),
    (error) => error.code === "INVALID_MEMBER_PROFILE",
  );
});

test("connecting and disposing drive the underlying client", () => {
  const { shared, stub, changes } = session();
  shared.connect();
  assert.equal(stub.calls.connected, 1);

  shared.dispose();
  assert.equal(stub.calls.disconnected, 1);

  const before = changes.length;
  shared.adopt([PAGE]);
  assert.equal(changes.length, before, "a disposed session stops re-rendering the editor");
});

test("status and role come from the sync client", () => {
  const statuses = [];
  const { shared, stub } = session({ onStatus: (state) => statuses.push(state.status) });
  shared.connect();

  stub.emit().onStatus({ status: "connected", role: "editor" });
  assert.equal(shared.status, "connected");
  assert.equal(shared.role, "editor");
  assert.deepEqual(statuses, ["connected"]);
});
