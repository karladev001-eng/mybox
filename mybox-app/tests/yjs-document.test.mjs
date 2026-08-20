import assert from "node:assert/strict";
import test from "node:test";
import * as Y from "yjs";
import {
  applyPageMutation,
  applyUpdate,
  createProjectDoc,
  encodeState,
  listMemberColors,
  listMemberProfiles,
  readPage,
  seedPage,
  setMemberColor,
  setMemberProfile,
  textDelta,
} from "../src/knowledge/yjs-document.js";

const PAGE = Object.freeze({
  id: "page-1",
  title: "Shared Page",
  state: "active",
  tagIds: [],
  blocks: [
    { id: "block-1", type: "paragraph", text: "", checked: false, links: [] },
    { id: "block-2", type: "paragraph", text: "second", checked: false, links: [] },
  ],
});

test("shared account names and avatar URLs converge as non-secret profile metadata", () => {
  const { a, b, sync } = twoPeers();
  setMemberProfile(a, { profileId: "github:42", displayName: "Kan", avatarUrl: "https://avatars.example/u/42.png" });
  sync();
  assert.deepEqual(listMemberProfiles(b), [{
    profileId: "github:42",
    displayName: "Kan",
    avatarUrl: "https://avatars.example/u/42.png",
  }]);
  assert.throws(
    () => setMemberProfile(a, { profileId: "github:9", displayName: "", avatarUrl: "http://unsafe.example/avatar.png" }),
    /INVALID_MEMBER_PROFILE/,
  );
});

test("shared author colors and the last Block editor converge", () => {
  const { a, b, sync } = twoPeers();
  setMemberColor(a, "profile-a", "#67d7c4");
  applyPageMutation(a, PAGE.id, { type: "block-update", blockId: "block-1", text: "owned" }, { actorId: "profile-a" });
  sync();
  assert.deepEqual(listMemberColors(b), [{ profileId: "profile-a", color: "#67d7c4" }]);
  assert.equal(readPage(b, PAGE.id).updatedBy, "profile-a");
  assert.equal(readPage(b, PAGE.id).blocks[0].updatedBy, "profile-a");
});

/** Two devices that have seen the same Page and can exchange updates. */
function twoPeers() {
  const a = createProjectDoc();
  seedPage(a, PAGE);
  const b = createProjectDoc();
  applyUpdate(b, encodeState(a));
  const sync = () => {
    applyUpdate(b, encodeState(a));
    applyUpdate(a, encodeState(b));
  };
  return { a, b, sync };
}

test("a text edit is expressed as the smallest single range", () => {
  assert.equal(textDelta("abc", "abc"), null);
  assert.deepEqual(textDelta("", "hi"), { index: 0, remove: 0, insert: "hi" });
  assert.deepEqual(textDelta("hello", "hello world"), { index: 5, remove: 0, insert: " world" });
  assert.deepEqual(textDelta("hello world", "hello"), { index: 5, remove: 6, insert: "" });
  // An insertion in the middle keeps both sides untouched.
  assert.deepEqual(textDelta("ac", "abc"), { index: 1, remove: 0, insert: "b" });
  assert.deepEqual(textDelta("日本語", "日本の語"), { index: 2, remove: 0, insert: "の" });
});

test("an edit boundary never splits a surrogate pair", () => {
  const delta = textDelta("a😀b", "a😀c");
  const rebuilt = "a😀b".slice(0, delta.index) + delta.insert + "a😀b".slice(delta.index + delta.remove);
  assert.equal(rebuilt, "a😀c");
  const added = textDelta("ab", "a😀b");
  const rebuiltAdded = "ab".slice(0, added.index) + added.insert + "ab".slice(added.index + added.remove);
  assert.equal(rebuiltAdded, "a😀b");
});

test("reads a seeded Page back in the shape the editor already uses", () => {
  const doc = createProjectDoc();
  seedPage(doc, PAGE);
  assert.deepEqual(readPage(doc, PAGE.id), PAGE);
  assert.equal(readPage(doc, "missing"), null);
});

test("two people typing in one paragraph keep both edits", () => {
  const { a, b, sync } = twoPeers();

  // Neither has seen the other yet: this is the case the revision model rejects.
  applyPageMutation(a, PAGE.id, { type: "block-update", blockId: "block-1", text: "Hello" });
  applyPageMutation(b, PAGE.id, { type: "block-update", blockId: "block-1", text: " world" });
  sync();

  const fromA = readPage(a, PAGE.id).blocks[0].text;
  const fromB = readPage(b, PAGE.id).blocks[0].text;
  assert.equal(fromA, fromB, "peers converge");
  assert.ok(fromA.includes("Hello"), `kept A's edit: ${fromA}`);
  assert.ok(fromA.includes("world"), `kept B's edit: ${fromA}`);
});

test("an edit at the start survives a concurrent edit at the end", () => {
  const { a, b, sync } = twoPeers();
  applyPageMutation(a, PAGE.id, { type: "block-update", blockId: "block-2", text: "second half" });
  sync();

  applyPageMutation(a, PAGE.id, { type: "block-update", blockId: "block-2", text: "the second half" });
  applyPageMutation(b, PAGE.id, { type: "block-update", blockId: "block-2", text: "second half!" });
  sync();

  const text = readPage(a, PAGE.id).blocks[0 + 1].text;
  assert.equal(text, readPage(b, PAGE.id).blocks[1].text);
  assert.ok(text.startsWith("the "), `kept the prefix edit: ${text}`);
  assert.ok(text.endsWith("!"), `kept the suffix edit: ${text}`);
});

test("concurrent Block additions both survive and agree on order", () => {
  const { a, b, sync } = twoPeers();
  applyPageMutation(a, PAGE.id, {
    type: "block-add",
    afterBlockId: "block-1",
    block: { id: "from-a", type: "paragraph", text: "A", checked: false, links: [] },
  });
  applyPageMutation(b, PAGE.id, {
    type: "block-add",
    afterBlockId: "block-1",
    block: { id: "from-b", type: "paragraph", text: "B", checked: false, links: [] },
  });
  sync();

  const idsA = readPage(a, PAGE.id).blocks.map((block) => block.id);
  const idsB = readPage(b, PAGE.id).blocks.map((block) => block.id);
  assert.deepEqual(idsA, idsB, "both devices order the Blocks the same way");
  assert.ok(idsA.includes("from-a") && idsA.includes("from-b"), idsA.join(","));
  assert.equal(idsA.length, 4);
});

test("a removal on one side and an edit on the other converge", () => {
  const { a, b, sync } = twoPeers();
  applyPageMutation(a, PAGE.id, { type: "block-remove", blockId: "block-2" });
  applyPageMutation(b, PAGE.id, { type: "block-update", blockId: "block-2", text: "edited" });
  sync();

  assert.deepEqual(
    readPage(a, PAGE.id).blocks.map((block) => block.id),
    readPage(b, PAGE.id).blocks.map((block) => block.id),
  );
});

test("structural mutations apply and project back correctly", () => {
  const doc = createProjectDoc();
  seedPage(doc, PAGE);

  applyPageMutation(doc, PAGE.id, { type: "rename", title: "Renamed" });
  applyPageMutation(doc, PAGE.id, { type: "block-update", blockId: "block-1", blockType: "heading-1", checked: true });
  applyPageMutation(doc, PAGE.id, { type: "tags-set", tagIds: ["tag-1", "tag-2"] });
  applyPageMutation(doc, PAGE.id, { type: "page-state", state: "trash" });

  const page = readPage(doc, PAGE.id);
  assert.equal(page.title, "Renamed");
  assert.equal(page.state, "trash");
  assert.deepEqual(page.tagIds, ["tag-1", "tag-2"]);
  assert.equal(page.blocks[0].type, "heading-1");
  assert.equal(page.blocks[0].checked, true);
});

test("moving a Block reorders it and keeps its content", () => {
  const doc = createProjectDoc();
  seedPage(doc, PAGE);
  applyPageMutation(doc, PAGE.id, { type: "block-move", blockId: "block-2", beforeBlockId: "block-1" });

  const page = readPage(doc, PAGE.id);
  assert.deepEqual(page.blocks.map((block) => block.id), ["block-2", "block-1"]);
  assert.equal(page.blocks[0].text, "second");

  applyPageMutation(doc, PAGE.id, { type: "block-move", blockId: "block-2", beforeBlockId: null });
  assert.deepEqual(readPage(doc, PAGE.id).blocks.map((block) => block.id), ["block-1", "block-2"]);
});

test("a PageLink keeps its token and target through a merge", () => {
  const { a, b, sync } = twoPeers();
  applyPageMutation(a, PAGE.id, {
    type: "link-add",
    blockId: "block-1",
    text: "see [[Target]]",
    targetPageId: "page-9",
    token: "[[Target]]",
  });
  sync();

  const block = readPage(b, PAGE.id).blocks[0];
  assert.equal(block.text, "see [[Target]]");
  assert.deepEqual(block.links, [{ targetPageId: "page-9", token: "[[Target]]" }]);
});

test("an unknown mutation is refused rather than silently ignored", () => {
  const doc = createProjectDoc();
  seedPage(doc, PAGE);
  assert.throws(() => applyPageMutation(doc, PAGE.id, { type: "drop-everything" }), /INVALID_PAGE_MUTATION/);
  assert.throws(() => applyPageMutation(doc, "missing", { type: "rename", title: "x" }), /PAGE_NOT_FOUND/);
  assert.throws(
    () => applyPageMutation(doc, PAGE.id, { type: "block-update", blockId: "nope", text: "x" }),
    /BLOCK_NOT_FOUND/,
  );
});

test("a peer joining late reaches the same state from one update", () => {
  const a = createProjectDoc();
  seedPage(a, PAGE);
  applyPageMutation(a, PAGE.id, { type: "block-update", blockId: "block-1", text: "written while alone" });

  const late = createProjectDoc();
  applyUpdate(late, encodeState(a));
  assert.deepEqual(readPage(late, PAGE.id), readPage(a, PAGE.id));
});

test("the encoded state is a Yjs update the library accepts", () => {
  const doc = createProjectDoc();
  seedPage(doc, PAGE);
  const plain = new Y.Doc();
  Y.applyUpdate(plain, encodeState(doc));
  assert.equal(plain.getMap("pages").get(PAGE.id).get("title"), "Shared Page");
});
