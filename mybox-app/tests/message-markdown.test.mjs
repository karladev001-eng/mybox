import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageMarkdown } from "../src/MessageMarkdown.js";

const render = (text) => renderToStaticMarkup(createElement(MessageMarkdown, { text }));
test("message Markdown renders tables, emphasis, lists, headings and code semantically", () => {
  const html = render("## 比較\n\n| モデル | 特徴 |\n|---|---|\n| A | **高速** |\n\n- 項目\n\n> 引用\n\n```js\nconst x = '<tag>';\n```");
  for (const token of ["<h2>", "<table>", "<th scope=\"col\">", "<strong>高速</strong>", "<ul>", "<blockquote>", "&lt;tag&gt;"]) assert.ok(html.includes(token), token);
  assert.ok(html.includes('tabindex="0"'));
});
test("message Markdown does not execute HTML, unsafe URLs, or fetch inline images", () => {
  const html = render('[危険](javascript:alert%281%29)\n\n<img src="x" onerror="alert(1)">\n\n![画像](https://example.test/track.png)\n\n[安全](https://example.test/)');
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("javascript:"));
  assert.ok(!html.includes("onerror"));
  assert.ok(!html.includes("track.png"));
  assert.ok(html.includes('href="https://example.test/"'));
});
