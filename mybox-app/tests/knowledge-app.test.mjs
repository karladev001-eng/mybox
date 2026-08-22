import assert from "node:assert/strict";
import test from "node:test";
import { AppHost } from "../src/core/app-host.js";
import { createProfilePreferencesStore } from "../src/core/profile-preferences.js";
import { createAppStorage, MemoryStorageDriver } from "../src/core/storage.js";
import { createKnowledgeApp } from "../src/knowledge/app.js";
import {
  applyColorWrap,
  buildInlineNodes,
  groupedListEnter,
  indentTextSelection,
  markdownConversion,
  parseMarkdownBlocks,
  parsePastedBlocks,
  splitPastedBlock,
  splitListItems,
  toggleInlineWrap,
} from "../src/knowledge/editor-behavior.js";
import { AUTHOR_COLOR_PALETTE } from "../src/knowledge/author-color.js";
import {
  createKnowledgeState,
  createPage,
  movePageToTrash,
  normalizePageTitle,
  purgePage,
  readPage,
  searchPages,
  listProjectMembers,
  setProjectMemberColor,
  updatePage,
} from "../src/knowledge/domain.js";

function deterministicIds() {
  let value = 0;
  return (prefix) => `${prefix}-${++value}`;
}

function fixture() {
  const idFactory = deterministicIds();
  const now = new Date("2026-08-16T00:00:00.000Z");
  const state = createKnowledgeState({ idFactory, now });
  return { state, idFactory, now, projectId: state.projects[0].id };
}

test("keeps consecutive list items inside one structured Block", () => {
  const firstItem = "最初の項目";
  assert.deepEqual(markdownConversion("- 最初の項目"), {
    text: firstItem,
    blockType: "bulleted-list",
    checked: undefined,
  });
  const continued = groupedListEnter(firstItem, firstItem.length);
  assert.deepEqual(continued, { exitList: false, text: `${firstItem}\n`, cursor: firstItem.length + 1 });
  assert.deepEqual(splitListItems(`${continued.text}次の項目`), ["最初の項目", "次の項目"]);
  assert.deepEqual(groupedListEnter(continued.text, continued.cursor), {
    exitList: true,
    text: firstItem,
    cursor: firstItem.length,
  });
});

test("Tab indents selected Note lines and Shift+Tab reverses it", () => {
  const indented = indentTextSelection("first\nsecond", 0, 12);
  assert.deepEqual(indented, { text: "  first\n  second", start: 2, end: 16 });
  assert.deepEqual(indentTextSelection(indented.text, indented.start, indented.end, true), {
    text: "first\nsecond",
    start: 0,
    end: 12,
  });
});

test("stores an Owner-selected basic color for each Project member", () => {
  const setup = fixture();
  setup.state.projects[0].members.push({ profileId: "editor-user", role: "editor" });
  const colored = setProjectMemberColor(setup.state, {
    projectId: setup.projectId,
    memberProfileId: "editor-user",
    color: AUTHOR_COLOR_PALETTE[3],
  });
  assert.equal(listProjectMembers(colored.state, { projectId: setup.projectId }).find((member) => member.profileId === "editor-user").color, AUTHOR_COLOR_PALETTE[3]);
});

test("normalizes Page titles and reserves them while the Page is in Trash", () => {
  const setup = fixture();
  assert.equal(normalizePageTitle("  Ｍｙ Ｐａｇｅ  "), normalizePageTitle("my page"));
  const created = createPage(setup.state, {
    projectId: setup.projectId,
    title: "Ｍｙ Ｐａｇｅ",
    idFactory: setup.idFactory,
    now: setup.now,
  });
  const trashed = movePageToTrash(created.state, {
    projectId: setup.projectId,
    pageId: created.page.id,
    expectedRevision: created.page.revision,
    idFactory: setup.idFactory,
    now: setup.now,
  });
  assert.throws(
    () => createPage(trashed.state, {
      projectId: setup.projectId,
      title: " my page ",
      idFactory: setup.idFactory,
      now: setup.now,
    }),
    (error) => error.code === "PAGE_TITLE_CONFLICT" && error.details.conflictingState === "trash",
  );
});

test("Trash converts backlinks to text and a new PageLink restores the same Page", () => {
  const setup = fixture();
  const pageA = createPage(setup.state, {
    projectId: setup.projectId,
    title: "Page A",
    idFactory: setup.idFactory,
    now: setup.now,
  });
  const pageB = createPage(pageA.state, {
    projectId: setup.projectId,
    title: "Page B",
    idFactory: setup.idFactory,
    now: setup.now,
  });
  const sourceBlock = pageA.page.blocks[0];
  const linked = updatePage(pageB.state, {
    projectId: setup.projectId,
    pageId: pageA.page.id,
    expectedRevision: pageA.page.revision,
    mutation: {
      type: "link-add",
      blockId: sourceBlock.id,
      targetPageId: pageB.page.id,
      text: "See [[Page B",
      markerStart: 4,
      markerEnd: 12,
    },
    idFactory: setup.idFactory,
    now: setup.now,
  });
  assert.equal(linked.page.blocks[0].text, "See [[Page B]]");

  const currentB = readPage(linked.state, { projectId: setup.projectId, pageId: pageB.page.id });
  const trashed = movePageToTrash(linked.state, {
    projectId: setup.projectId,
    pageId: currentB.id,
    expectedRevision: currentB.revision,
    idFactory: setup.idFactory,
    now: setup.now,
  });
  const plainA = readPage(trashed.state, { projectId: setup.projectId, pageId: pageA.page.id });
  assert.equal(plainA.blocks[0].text, "See Page B");
  assert.deepEqual(plainA.blocks[0].links, []);

  const restoredLink = updatePage(trashed.state, {
    projectId: setup.projectId,
    pageId: plainA.id,
    expectedRevision: plainA.revision,
    mutation: {
      type: "link-add",
      blockId: plainA.blocks[0].id,
      targetPageId: pageB.page.id,
      text: "See Page B and [[Page B",
      markerStart: 15,
      markerEnd: 23,
    },
    idFactory: setup.idFactory,
    now: setup.now,
  });
  const restoredB = readPage(restoredLink.state, { projectId: setup.projectId, pageId: pageB.page.id });
  assert.equal(restoredB.state, "active");
  assert.equal(restoredLink.page.blocks[0].text, "See Page B and [[Page B]]");
  assert.equal(restoredLink.page.blocks[0].links[0].targetPageId, pageB.page.id);
});

test("creates a linked Page and its resolved PageLink atomically", () => {
  const setup = fixture();
  const source = createPage(setup.state, {
    projectId: setup.projectId,
    title: "Source",
    idFactory: setup.idFactory,
    now: setup.now,
  });
  const linked = updatePage(source.state, {
    projectId: setup.projectId,
    pageId: source.page.id,
    expectedRevision: source.page.revision,
    mutation: {
      type: "link-add",
      blockId: source.page.blocks[0].id,
      createTitle: "New target",
      text: "Open [[New target",
      markerStart: 5,
      markerEnd: 17,
    },
    idFactory: setup.idFactory,
    now: setup.now,
  });
  const target = linked.state.pages.find((page) => page.title === "New target");
  assert.equal(linked.page.blocks[0].text, "Open [[New target]]");
  assert.equal(linked.page.blocks[0].links[0].targetPageId, target.id);
  assert.equal(target.state, "active");
});

test("only an Owner can permanently delete and the title becomes reusable", () => {
  const setup = fixture();
  setup.state.projects[0].members.push({ profileId: "editor-user", role: "editor" });
  const created = createPage(setup.state, {
    projectId: setup.projectId,
    title: "Reusable",
    idFactory: setup.idFactory,
    now: setup.now,
  });
  assert.throws(
    () => purgePage(created.state, {
      projectId: setup.projectId,
      pageId: created.page.id,
      expectedRevision: created.page.revision,
      profileId: "editor-user",
      idFactory: setup.idFactory,
      now: setup.now,
    }),
    (error) => error.code === "PROJECT_ROLE_REQUIRED",
  );
  const purged = purgePage(created.state, {
    projectId: setup.projectId,
    pageId: created.page.id,
    expectedRevision: created.page.revision,
    idFactory: setup.idFactory,
    now: setup.now,
  });
  const recreated = createPage(purged.state, {
    projectId: setup.projectId,
    title: "Reusable",
    idFactory: setup.idFactory,
    now: setup.now,
  });
  assert.notEqual(recreated.page.id, created.page.id);
});

test("rejects stale revisions and records the previous revision", () => {
  const setup = fixture();
  const created = createPage(setup.state, {
    projectId: setup.projectId,
    title: "Revision",
    idFactory: setup.idFactory,
    now: setup.now,
  });
  const changed = updatePage(created.state, {
    projectId: setup.projectId,
    pageId: created.page.id,
    expectedRevision: 1,
    mutation: { type: "rename", title: "Revision 2" },
    idFactory: setup.idFactory,
    now: setup.now,
  });
  assert.throws(
    () => updatePage(changed.state, {
      projectId: setup.projectId,
      pageId: created.page.id,
      expectedRevision: 1,
      mutation: { type: "rename", title: "Stale" },
      idFactory: setup.idFactory,
      now: setup.now,
    }),
    (error) => error.code === "REVISION_CONFLICT" && error.details.actualRevision === 2,
  );
  assert.equal(changed.state.history.length, 1);
});

test("search scopes Trash explicitly and returns Block-level identities", () => {
  const setup = fixture();
  const created = createPage(setup.state, {
    projectId: setup.projectId,
    title: "Search target",
    idFactory: setup.idFactory,
    now: setup.now,
  });
  const edited = updatePage(created.state, {
    projectId: setup.projectId,
    pageId: created.page.id,
    expectedRevision: created.page.revision,
    mutation: { type: "block-update", blockId: created.page.blocks[0].id, text: "agent-readable evidence" },
    idFactory: setup.idFactory,
    now: setup.now,
  });
  const activeResults = searchPages(edited.state, { query: "evidence", projectIds: [setup.projectId] });
  assert.equal(activeResults[0].blockId, created.page.blocks[0].id);
  const trashed = movePageToTrash(edited.state, {
    projectId: setup.projectId,
    pageId: created.page.id,
    expectedRevision: edited.page.revision,
    idFactory: setup.idFactory,
    now: setup.now,
  });
  assert.equal(searchPages(trashed.state, { query: "evidence", projectIds: [setup.projectId] }).length, 0);
  assert.equal(searchPages(trashed.state, { query: "evidence", projectIds: [setup.projectId], includeTrash: true }).length, 1);
});

test("routes Knowledge Operations through AppHost and persists them", async () => {
  const host = new AppHost({ storageDriver: new MemoryStorageDriver() });
  host.register(createKnowledgeApp());
  const actor = { type: "user", id: "local-user" };
  const { projects } = await host.invoke("knowledge.project.list", {}, { actor });
  const created = await host.invoke("knowledge.page.create", {
    projectId: projects[0].id,
    title: "Operation Page",
  }, { actor });
  const read = await host.invoke("knowledge.page.read", {
    projectId: projects[0].id,
    pageId: created.page.id,
  }, { actor });
  assert.equal(read.page.title, "Operation Page");
  assert.equal(host.listOperations({ callerType: "agent" }).some((item) => item.id === "knowledge.page.search"), true);
});

test("describes the Page mutation vocabulary to agents while still accepting the editor's own shapes", async () => {
  const host = new AppHost({ storageDriver: new MemoryStorageDriver() });
  host.register(createKnowledgeApp());
  const actor = { type: "user", id: "local-user" };

  // The Operation's input schema is the only description of a mutation an agent
  // sees, so an opaque `{ type: "object" }` left it guessing the vocabulary.
  const update = host.listOperations({ callerType: "agent" }).find((item) => item.id === "knowledge.page.update");
  const mutation = update.inputSchema.properties.mutation;
  assert.deepEqual(mutation.required, ["type"]);
  assert.deepEqual(
    [...mutation.properties.type.enum].sort(),
    ["block-add", "block-move", "block-paste", "block-remove", "block-update", "link-add", "markdown-set", "rename", "tags-set"],
  );
  assert.ok(mutation.description.includes("block-add"));
  // Without these an agent writes a whole document into one paragraph Block,
  // drawing headings and bullets as characters instead of using Block types.
  assert.ok(mutation.description.includes("A Page is a list of Blocks"));
  // Writing prose Block by Block exhausts the agent's step budget, so the
  // schema has to point at markdown-set as the way to write a document.
  assert.ok(mutation.description.includes("markdown-set"));
  assert.ok(mutation.description.includes("Prefer this over repeated block-add"));

  const { projects } = await host.invoke("knowledge.project.list", {}, { actor });
  const projectId = projects[0].id;
  const { page } = await host.invoke("knowledge.page.create", { projectId, title: "Mutation Page" }, { actor });

  // The editor omits afterBlockId entirely when the Page has no Blocks yet.
  const added = await host.invoke("knowledge.page.update", {
    projectId,
    pageId: page.id,
    expectedRevision: page.revision,
    mutation: { type: "block-add", afterBlockId: undefined, blockType: "quote", text: "引用" },
  }, { actor });
  assert.equal(added.page.blocks.at(-1).type, "quote");

  // A mutation with no type is now refused by the schema, before the domain sees it.
  await assert.rejects(
    () => host.invoke("knowledge.page.update", {
      projectId,
      pageId: page.id,
      expectedRevision: added.page.revision,
      mutation: { blockId: "block-1", text: "hi" },
    }, { actor }),
    (error) => error.code === "INVALID_OPERATION_INPUT",
  );
});

test("persists the device confirmation level through the profile storage port", async () => {
  const driver = new MemoryStorageDriver();
  const firstStore = createProfilePreferencesStore(createAppStorage("mybox-host", driver));
  const initial = await firstStore.load();
  assert.equal(initial.confirmationLevel, "review");
  await firstStore.setConfirmationLevel(initial, "recoverable");

  const restartedStore = createProfilePreferencesStore(createAppStorage("mybox-host", driver));
  assert.equal((await restartedStore.load()).confirmationLevel, "recoverable");
});

test("converts a $$ marker into an empty math Block", () => {
  assert.deepEqual(markdownConversion("$$"), { text: "", blockType: "math", checked: false });
});

test("converts a bare URL into a url-embed Block, but not a sentence merely containing one", () => {
  assert.deepEqual(
    markdownConversion("https://example.com/path?x=1"),
    { text: "https://example.com/path?x=1", blockType: "url-embed", checked: false },
  );
  assert.equal(markdownConversion("https://example.com is a great site"), null);
  assert.equal(markdownConversion("see https://example.com"), null);
});

test("tokenizes bold, italic, underline, strike, color, math, and PageLink segments", () => {
  const nodes = buildInlineNodes(
    "start **bold** *italic* __under__ ~~gone~~ %%#ff0000;red%% $x^2$ [[Target Page]] end",
    [{ token: "[[Target Page]]", targetPageId: "page-9" }],
  );
  assert.deepEqual(nodes, [
    { type: "text", value: "start " },
    { type: "bold", value: "bold" },
    { type: "text", value: " " },
    { type: "italic", value: "italic" },
    { type: "text", value: " " },
    { type: "underline", value: "under" },
    { type: "text", value: " " },
    { type: "strike", value: "gone" },
    { type: "text", value: " " },
    { type: "color", value: "red", color: "#ff0000" },
    { type: "text", value: " " },
    { type: "math", value: "x^2" },
    { type: "text", value: " " },
    { type: "link", value: "Target Page", targetPageId: "page-9" },
    { type: "text", value: " end" },
  ]);
});

test("toggles a bold wrap around the selection and unwraps it on a second toggle", () => {
  const wrapped = toggleInlineWrap("hello world", 6, 11, "bold");
  assert.deepEqual(wrapped, { text: "hello **world**", start: 8, end: 13 });
  const unwrapped = toggleInlineWrap(wrapped.text, wrapped.start, wrapped.end, "bold");
  assert.deepEqual(unwrapped, { text: "hello world", start: 6, end: 11 });
});

test("applies a text-color wrap around the selection", () => {
  const colored = applyColorWrap("hello world", 6, 11, "4dabf7");
  assert.deepEqual(colored, { text: "hello %%#4dabf7;world%%", start: 16, end: 21 });
  assert.equal(applyColorWrap("hello world", 6, 11, "bad-hex"), null);
});

test("block-move with beforeBlockId reorders Blocks independent of direction", () => {
  const setup = fixture();
  const created = createPage(setup.state, {
    projectId: setup.projectId,
    title: "Reorder Page",
    idFactory: setup.idFactory,
    now: setup.now,
  });
  let state = created.state;
  let page = created.page;
  let revision = page.revision;
  for (let index = 0; index < 2; index += 1) {
    const added = updatePage(state, {
      projectId: setup.projectId,
      pageId: page.id,
      expectedRevision: revision,
      mutation: { type: "block-add", afterBlockId: page.blocks.at(-1).id, blockType: "paragraph" },
      idFactory: setup.idFactory,
      now: setup.now,
    });
    state = added.state;
    page = added.page;
    revision = page.revision;
  }
  const [firstId, secondId, thirdId] = page.blocks.map((block) => block.id);

  const moved = updatePage(state, {
    projectId: setup.projectId,
    pageId: page.id,
    expectedRevision: revision,
    mutation: { type: "block-move", blockId: thirdId, beforeBlockId: firstId },
    idFactory: setup.idFactory,
    now: setup.now,
  });
  assert.deepEqual(moved.page.blocks.map((block) => block.id), [thirdId, firstId, secondId]);

  const movedToEnd = updatePage(moved.state, {
    projectId: setup.projectId,
    pageId: page.id,
    expectedRevision: moved.page.revision,
    mutation: { type: "block-move", blockId: firstId, beforeBlockId: null },
    idFactory: setup.idFactory,
    now: setup.now,
  });
  assert.deepEqual(movedToEnd.page.blocks.map((block) => block.id), [thirdId, secondId, firstId]);
});

test("block-update accepts the math Block type", () => {
  const setup = fixture();
  const created = createPage(setup.state, {
    projectId: setup.projectId,
    title: "Math Page",
    idFactory: setup.idFactory,
    now: setup.now,
  });
  const updated = updatePage(created.state, {
    projectId: setup.projectId,
    pageId: created.page.id,
    expectedRevision: created.page.revision,
    mutation: { type: "block-update", blockId: created.page.blocks[0].id, blockType: "math", text: "E = mc^2" },
    idFactory: setup.idFactory,
    now: setup.now,
  });
  assert.equal(updated.page.blocks[0].type, "math");
  assert.equal(updated.page.blocks[0].text, "E = mc^2");
});

test("announces an agent's Page write to subscribers, so an open editor can catch up", async () => {
  const host = new AppHost({ storageDriver: new MemoryStorageDriver() });
  host.register(createKnowledgeApp());
  const actor = { type: "user", id: "local-user" };
  const { projects } = await host.invoke("knowledge.project.list", {}, { actor });
  const projectId = projects[0].id;
  const { page } = await host.invoke("knowledge.page.create", { projectId, title: "Watched Page" }, { actor });

  // KnowledgeView subscribes to exactly these and reloads, so every one of them
  // must stay declared or `subscribe` throws EVENT_NOT_FOUND and the View dies.
  const seen = [];
  const unsubscribes = ["knowledge.page.changed", "knowledge.page.purged", "knowledge.project.created", "knowledge.project.deleted"]
    .map((eventId) => host.subscribe(eventId, (envelope) => seen.push(envelope)));

  const renamed = await host.invoke("knowledge.page.update", {
    projectId,
    pageId: page.id,
    expectedRevision: page.revision,
    mutation: { type: "rename", title: "日常のツールボックス" },
  }, { actor });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, "knowledge.page.changed");
  // The View compares these two against the Page it holds to tell an external
  // write apart from the one it just made itself.
  assert.equal(seen[0].payload.pageId, page.id);
  assert.equal(seen[0].payload.revision, renamed.page.revision);
  assert.notEqual(renamed.page.revision, page.revision);

  unsubscribes.forEach((unsubscribe) => unsubscribe());
  await host.invoke("knowledge.page.update", {
    projectId,
    pageId: page.id,
    expectedRevision: renamed.page.revision,
    mutation: { type: "rename", title: "戻した" },
  }, { actor });
  assert.equal(seen.length, 1);
});

test("routes a shared Project's writes to its document, so the assistant and the editor see one Page", async () => {
  const host = new AppHost({ storageDriver: new MemoryStorageDriver() });
  // Stands in for the live Yjs session the View owns; the App only ever sees
  // this port, never the socket behind it.
  const document = new Map();
  const session = {
    listPages: () => [...document.values()].map(({ id, title }) => ({ id, title, state: "active", excerpt: "" })),
    readPage: (pageId) => (document.has(pageId)
      ? { page: { ...document.get(pageId), revision: 0, state: "active" }, tags: [], backlinks: [] }
      : null),
    mutate: (pageId, mutation) => {
      if (mutation.type !== "rename") throw new Error(`unsupported: ${mutation.type}`);
      document.set(pageId, { ...document.get(pageId), title: mutation.title });
    },
  };
  const sharedProjectIds = new Set();
  host.register(createKnowledgeApp({
    sharedSessions: { get: (projectId) => (sharedProjectIds.has(projectId) ? session : null) },
  }));

  const actor = { type: "user", id: "local-user" };
  const { projects } = await host.invoke("knowledge.project.list", {}, { actor });
  const projectId = projects[0].id;
  const { page } = await host.invoke("knowledge.page.create", { projectId, title: "共有前" }, { actor });

  // The Project becomes shared: its document is now what the editor renders.
  document.set(page.id, { id: page.id, projectId, title: "共有前", blocks: [], tagIds: [] });
  sharedProjectIds.add(projectId);

  // An assistant write. Before the write paths were unified this landed in the
  // JSON store while the editor kept reading the document, so it was invisible.
  const updated = await host.invoke("knowledge.page.update", {
    projectId,
    pageId: page.id,
    expectedRevision: 0,
    mutation: { type: "rename", title: "日常のツールボックス" },
  }, { actor });

  assert.equal(updated.page.title, "日常のツールボックス");
  assert.equal(document.get(page.id).title, "日常のツールボックス");
  // The same Operation the editor reads through now returns the document too.
  const read = await host.invoke("knowledge.page.read", { projectId, pageId: page.id }, { actor });
  assert.equal(read.page.title, "日常のツールボックス");
  assert.deepEqual((await host.invoke("knowledge.page.list", { projectId }, { actor })).pages.map((p) => p.title), ["日常のツールボックス"]);

  // A local Project still goes to the JSON store, untouched by any of this.
  const { project: localProject } = await host.invoke("knowledge.project.create", { name: "ローカル" }, { actor });
  const local = await host.invoke("knowledge.page.create", { projectId: localProject.id, title: "ローカルPage" }, { actor });
  const localRead = await host.invoke("knowledge.page.read", { projectId: localProject.id, pageId: local.page.id }, { actor });
  assert.equal(localRead.page.title, "ローカルPage");
});

test("parses a Markdown document into typed Blocks, grouping list items into one Block", () => {
  const blocks = parseMarkdownBlocks([
    "# 日常のツールボックス",
    "",
    "毎日の作業を少し便利にするため、",
    "次のアプリをまとめておくと役立ちます。",
    "",
    "## メモ・情報整理",
    "- Notion",
    "- Obsidian",
    "* Apple メモ",
    "",
    "1. 今日の予定",
    "2. ToDoリスト",
    "",
    "- [x] 済んだこと",
    "- [ ] これから",
    "",
    "> 引用文",
    "",
    "```js",
    "const a = 1;",
    "",
    "const b = 2;",
    "```",
    "",
    "---",
    "https://example.com",
  ].join("\n"));

  assert.deepEqual(blocks, [
    { type: "heading-1", text: "日常のツールボックス", checked: false },
    { type: "paragraph", text: "毎日の作業を少し便利にするため、\n次のアプリをまとめておくと役立ちます。", checked: false },
    { type: "heading-2", text: "メモ・情報整理", checked: false },
    // One Block, newline-separated, exactly how the editor stores a list.
    { type: "bulleted-list", text: "Notion\nObsidian\nApple メモ", checked: false },
    { type: "numbered-list", text: "今日の予定\nToDoリスト", checked: false },
    // A checklist Block carries one flag, so items stay separate.
    { type: "checklist", text: "済んだこと", checked: true },
    { type: "checklist", text: "これから", checked: false },
    { type: "quote", text: "引用文", checked: false },
    // A blank line inside a fence belongs to the code, not to the document.
    { type: "code", text: "const a = 1;\n\nconst b = 2;", checked: false },
    { type: "divider", text: "", checked: false },
    { type: "url-embed", text: "https://example.com", checked: false },
  ]);
});

test("splits pasted prose at hard line breaks while preserving Markdown structures", () => {
  assert.deepEqual(parsePastedBlocks([
    "# 見出し",
    "1行目",
    "2行目",
    "- 項目A",
    "- 項目B",
    "```js",
    "const a = 1;",
    "const b = 2;",
    "```",
  ].join("\n")), [
    { type: "heading-1", text: "見出し", checked: false },
    { type: "paragraph", text: "1行目", checked: false },
    { type: "paragraph", text: "2行目", checked: false },
    { type: "bulleted-list", text: "項目A\n項目B", checked: false },
    { type: "code", text: "const a = 1;\nconst b = 2;", checked: false },
  ]);

  const split = splitPastedBlock(
    { type: "paragraph", text: "前後", checked: false, links: [] },
    "# 見出し\n本文",
    1,
    1,
  );
  assert.deepEqual(split.blocks.map(({ type, text, reuseSource }) => ({ type, text, reuseSource })), [
    { type: "paragraph", text: "前", reuseSource: true },
    { type: "heading-1", text: "見出し", reuseSource: false },
    { type: "paragraph", text: "本文", reuseSource: false },
    { type: "paragraph", text: "後", reuseSource: false },
  ]);
  assert.deepEqual({ start: split.pastedStart, end: split.pastedEnd }, { start: 1, end: 2 });
});

test("pastes multiline Markdown into one Page as independently editable Blocks", () => {
  const { state, projectId, idFactory, now } = fixture();
  const created = createPage(state, { projectId, title: "貼り付け", idFactory, now });
  const source = created.page.blocks[0];
  const pasted = updatePage(created.state, {
    projectId,
    pageId: created.page.id,
    expectedRevision: created.page.revision,
    idFactory,
    now,
    mutation: {
      type: "block-paste",
      blockId: source.id,
      text: "# 見出し\n本文1\n本文2",
      // The editor can contain unsaved characters when paste occurs; the
      // structural mutation carries that visible source text atomically.
      sourceText: "前後",
      selectionStart: 1,
      selectionEnd: 1,
    },
  });

  assert.deepEqual(pasted.page.blocks.map(({ type, text }) => ({ type, text })), [
    { type: "paragraph", text: "前" },
    { type: "heading-1", text: "見出し" },
    { type: "paragraph", text: "本文1" },
    { type: "paragraph", text: "本文2" },
    { type: "paragraph", text: "後" },
  ]);
  assert.equal(pasted.page.blocks[0].id, source.id);
  assert.equal(pasted.state.history.length, 1, "the whole paste is one recoverable Page change");
});

test("writes a whole document through one markdown-set mutation", async () => {
  const host = new AppHost({ storageDriver: new MemoryStorageDriver() });
  host.register(createKnowledgeApp());
  const actor = { type: "user", id: "local-user" };
  const { projects } = await host.invoke("knowledge.project.list", {}, { actor });
  const projectId = projects[0].id;
  const { page } = await host.invoke("knowledge.page.create", { projectId, title: "文書" }, { actor });

  const written = await host.invoke("knowledge.page.update", {
    projectId,
    pageId: page.id,
    expectedRevision: page.revision,
    mutation: { type: "markdown-set", markdown: "# 見出し\n\n本文です。\n\n- 一つ目\n- 二つ目\n" },
  }, { actor });

  // The new Page's single empty Block is replaced rather than left above the document.
  assert.deepEqual(
    written.page.blocks.map(({ type, text }) => ({ type, text })),
    [
      { type: "heading-1", text: "見出し" },
      { type: "paragraph", text: "本文です。" },
      { type: "bulleted-list", text: "一つ目\n二つ目" },
    ],
  );
  assert.ok(written.page.blocks.every((block) => block.id && block.revision === 1));

  // Appending is the default, so existing work is not discarded.
  const appended = await host.invoke("knowledge.page.update", {
    projectId,
    pageId: page.id,
    expectedRevision: written.page.revision,
    mutation: { type: "markdown-set", markdown: "## 追記" },
  }, { actor });
  assert.equal(appended.page.blocks.length, 4);
  assert.equal(appended.page.blocks.at(-1).type, "heading-2");

  const replaced = await host.invoke("knowledge.page.update", {
    projectId,
    pageId: page.id,
    expectedRevision: appended.page.revision,
    mutation: { type: "markdown-set", markdown: "書き直し", mode: "replace" },
  }, { actor });
  assert.deepEqual(replaced.page.blocks.map(({ text }) => text), ["書き直し"]);
});
