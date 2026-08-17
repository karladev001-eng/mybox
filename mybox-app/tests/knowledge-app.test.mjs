import assert from "node:assert/strict";
import test from "node:test";
import { AppHost } from "../src/core/app-host.js";
import { createProfilePreferencesStore } from "../src/core/profile-preferences.js";
import { createAppStorage, MemoryStorageDriver } from "../src/core/storage.js";
import { createKnowledgeApp } from "../src/knowledge/app.js";
import { groupedListEnter, markdownConversion, splitListItems } from "../src/knowledge/editor-behavior.js";
import {
  createKnowledgeState,
  createPage,
  movePageToTrash,
  normalizePageTitle,
  purgePage,
  readPage,
  searchPages,
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

test("persists the device confirmation level through the profile storage port", async () => {
  const driver = new MemoryStorageDriver();
  const firstStore = createProfilePreferencesStore(createAppStorage("mybox-host", driver));
  const initial = await firstStore.load();
  assert.equal(initial.confirmationLevel, "review");
  await firstStore.setConfirmationLevel(initial, "recoverable");

  const restartedStore = createProfilePreferencesStore(createAppStorage("mybox-host", driver));
  assert.equal((await restartedStore.load()).confirmationLevel, "recoverable");
});
