import assert from "node:assert/strict";
import test from "node:test";
import { filterPageSearchCandidates, pageSearchKeyAction } from "../src/knowledge/search-behavior.js";

test("Page search candidates match normalized titles and excerpts", () => {
  const pages = [
    { id: "1", title: "設計メモ", excerpt: "" },
    { id: "2", title: "Meeting", excerpt: "ＡＰＰの方針" },
    { id: "3", title: "買い物", excerpt: "食料品" },
  ];
  assert.deepEqual(filterPageSearchCandidates(pages, "app").map((page) => page.id), ["2"]);
  assert.deepEqual(filterPageSearchCandidates(pages, "設計").map((page) => page.id), ["1"]);
  assert.deepEqual(filterPageSearchCandidates(pages, ""), []);
});

test("Tab and Shift+Tab cycle Page search candidates", () => {
  assert.deepEqual(pageSearchKeyAction({ key: "Tab", shiftKey: false }, 0, 3), { type: "move", index: 1 });
  assert.deepEqual(pageSearchKeyAction({ key: "Tab", shiftKey: false }, 2, 3), { type: "move", index: 0 });
  assert.deepEqual(pageSearchKeyAction({ key: "Tab", shiftKey: true }, 0, 3), { type: "move", index: 2 });
});

test("Enter opens the active candidate and Escape closes the popup", () => {
  assert.deepEqual(pageSearchKeyAction({ key: "Enter" }, 1, 3), { type: "open", index: 1 });
  assert.deepEqual(pageSearchKeyAction({ key: "Escape" }, 1, 3), { type: "close" });
  assert.equal(pageSearchKeyAction({ key: "Enter" }, 0, 0), null);
});
