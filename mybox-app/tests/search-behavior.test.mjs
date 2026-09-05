import assert from "node:assert/strict";
import test from "node:test";
import { filterPageSearchCandidates, pageSearchKeyAction, knowledgeSearchCommands } from "../src/knowledge/search-behavior.js";

test("Page search candidates match normalized titles and excerpts", () => {
  const pages = [
    { id: "1", title: "設計メモ", excerpt: "" },
    { id: "2", title: "Meeting", excerpt: "ＡＰＰの方針" },
    { id: "3", title: "買い物", excerpt: "食料品" },
  ];
  assert.deepEqual(filterPageSearchCandidates(pages, "app").map((page) => page.id), ["2"]);
  assert.deepEqual(filterPageSearchCandidates(pages, "設計").map((page) => page.id), ["1"]);
  assert.deepEqual(filterPageSearchCandidates(pages, "").map((page) => page.id), ["1", "2", "3"]);
});

test("Arrow keys cycle candidates while Tab reaches search controls", () => {
  assert.equal(pageSearchKeyAction({ key: "Tab" }, 0, 3), null);
  assert.deepEqual(pageSearchKeyAction({ key: "ArrowDown" }, 0, 3), { type: "move", index: 1 });
  assert.deepEqual(pageSearchKeyAction({ key: "ArrowDown" }, 2, 3), { type: "move", index: 0 });
  assert.deepEqual(pageSearchKeyAction({ key: "ArrowUp" }, 0, 3), { type: "move", index: 2 });
});

test("Enter opens the active candidate and Escape closes the popup", () => {
  assert.deepEqual(pageSearchKeyAction({ key: "Enter" }, 1, 3), { type: "open", index: 1 });
  assert.deepEqual(pageSearchKeyAction({ key: "Escape" }, 1, 3), { type: "close" });
  assert.equal(pageSearchKeyAction({ key: "Enter" }, 0, 0), null);
});


test("search keeps authorized tag matches, accepts multiple terms, and ignores IME Enter", () => {
  assert.equal(pageSearchKeyAction({ key: "Enter", isComposing: true }, 0, 2), null);
  assert.equal(pageSearchKeyAction({ key: "Enter", keyCode: 229 }, 0, 2), null);
  const pages = [{ id: "tags", title: "メモ", excerpt: "", matchedQuery: "設計 AI" }, { id: "text", title: "AI", excerpt: "設計" }, { id: "none", title: "AI", excerpt: "日記" }];
  assert.deepEqual(filterPageSearchCandidates(pages, "設計 AI").map((page) => page.id), ["tags", "text"]);
});

test("Project names are candidates and creation only follows a completed empty search", () => {
  const projects = [{ id: "a", name: "Personal", role: "owner" }, { id: "b", name: "Shared", role: "viewer" }];
  assert.equal(knowledgeSearchCommands(projects, projects[0], "Personal")[0].title, "Personal");
  assert.deepEqual(knowledgeSearchCommands(projects, projects[0], "missing", 1), []);
  assert.deepEqual(knowledgeSearchCommands(projects, projects[0], "missing", 0, false), []);
  assert.deepEqual(knowledgeSearchCommands(projects, projects[1], "missing"), []);
  assert.equal(knowledgeSearchCommands(projects, projects[0], "missing")[0].newTitle, "missing");
  assert.equal(knowledgeSearchCommands(projects, projects[0], "").some((c) => c.command === "create"), false);
});
