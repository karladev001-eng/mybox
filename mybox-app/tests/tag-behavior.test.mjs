import assert from "node:assert/strict";
import test from "node:test";
import { filterUsedTagCandidates, hasTagDelimiterAtEnd, isTagCommitKey, splitTagDraft } from "../src/knowledge/tag-behavior.js";

test("Space commits a Tag only after IME composition has finished", () => {
  assert.equal(isTagCommitKey({ key: " " }), true);
  assert.equal(isTagCommitKey({ key: "Unidentified", code: "Space" }), true);
  assert.equal(isTagCommitKey({ key: "　" }), true);
  assert.equal(isTagCommitKey({ key: " ", isComposing: true }), false);
  assert.equal(isTagCommitKey({ key: " ", nativeEvent: { isComposing: true } }), false);
  assert.equal(isTagCommitKey({ key: "Process", keyCode: 229 }), false);
});

test("detects a full-width Space delivered when IME composition ends", () => {
  assert.equal(hasTagDelimiterAtEnd("設計　"), true);
  assert.equal(hasTagDelimiterAtEnd("設計 "), true);
  assert.equal(hasTagDelimiterAtEnd("設計"), false);
});

test("a Space-delimited draft adds multiple Tags including full-width input", () => {
  assert.deepEqual(splitTagDraft("設計　アプリ idea,"), ["設計", "アプリ", "idea"]);
});

test("Tag candidates contain only used and unselected Tags", () => {
  const candidates = [
    { id: "1", label: "設計", pageCount: 2 },
    { id: "2", label: "未使用", pageCount: 0 },
    { id: "3", label: "アイデア", pageCount: 1 },
  ];
  assert.deepEqual(filterUsedTagCandidates(candidates, ["設計"], "アイ"), [candidates[2]]);
  assert.deepEqual(filterUsedTagCandidates(candidates, [], ""), [candidates[0], candidates[2]]);
});
