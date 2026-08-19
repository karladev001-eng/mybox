const groupedListTypes = new Set(["bulleted-list", "numbered-list"]);
// Deliberately permissive on the domain/path shape; this only decides when to
// switch the Block into an embed card, not whether the URL is reachable.
const BARE_URL_PATTERN = /^https?:\/\/\S+$/;

export function markdownConversion(value) {
  const rules = [
    [/^- \[[xX]\] /, "checklist", true],
    [/^- \[ \] /, "checklist", false],
    [/^### /, "heading-3"],
    [/^## /, "heading-2"],
    [/^# /, "heading-1"],
    [/^(?:- |\* )/, "bulleted-list"],
    [/^\d+\. /, "numbered-list"],
    [/^> /, "quote"],
    [/^```(?:[A-Za-z0-9_-]+)? ?/, "code"],
  ];
  for (const [pattern, blockType, checked] of rules) {
    if (pattern.test(value)) return { text: value.replace(pattern, ""), blockType, checked };
  }
  if (value === "---") return { text: "", blockType: "divider", checked: false };
  if (value === "$$") return { text: "", blockType: "math", checked: false };
  // Exact match, like the two rules above: only the whole field being a bare
  // URL converts it, so typing a sentence that happens to start with one
  // never triggers this mid-word.
  if (BARE_URL_PATTERN.test(value.trim())) return { text: value.trim(), blockType: "url-embed", checked: false };
  return null;
}

const BULLET_ITEM = /^[-*+] (?!\[[ xX]\])/;
const NUMBERED_ITEM = /^\d+\. /;
const THEMATIC_BREAK = /^(?:-{3,}|\*{3,}|_{3,})$/;

/** A line that would open a Block of its own, so a paragraph must stop before it. */
function startsNewBlock(trimmed) {
  return !trimmed || THEMATIC_BREAK.test(trimmed) || markdownConversion(trimmed) !== null;
}

function readFenced(lines, index, closes) {
  const body = [];
  let cursor = index + 1;
  while (cursor < lines.length && !closes(lines[cursor].trim())) {
    body.push(lines[cursor]);
    cursor += 1;
  }
  // An unterminated fence still ends the document rather than dropping its text.
  return { text: body.join("\n"), next: Math.min(cursor + 1, lines.length) };
}

/**
 * Parses a whole Markdown document into Blocks.
 *
 * `markdownConversion` decides one line at a time while the User types; this is
 * its document-level counterpart, for a caller handing over a finished text.
 * An agent writing a Page through one operation is the reason it exists: asked
 * to add Blocks one call at a time, it spends its whole step budget and settles
 * for a single Block holding a hand-drawn document.
 *
 * Consecutive bullets or numbers become one list Block, matching how the editor
 * stores list items as newline-separated text. Checklists do not group, because
 * a checklist Block carries one `checked` flag.
 */
export function parseMarkdownBlocks(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    if (/^```/.test(trimmed)) {
      const { text, next } = readFenced(lines, index, (line) => line === "```");
      blocks.push({ type: "code", text, checked: false });
      index = next;
      continue;
    }
    if (trimmed === "$$") {
      const { text, next } = readFenced(lines, index, (line) => line === "$$");
      blocks.push({ type: "math", text, checked: false });
      index = next;
      continue;
    }
    if (THEMATIC_BREAK.test(trimmed)) {
      blocks.push({ type: "divider", text: "", checked: false });
      index += 1;
      continue;
    }

    const list = BULLET_ITEM.test(trimmed)
      ? { pattern: BULLET_ITEM, blockType: "bulleted-list" }
      : NUMBERED_ITEM.test(trimmed)
        ? { pattern: NUMBERED_ITEM, blockType: "numbered-list" }
        : null;
    if (list) {
      const items = [];
      while (index < lines.length && list.pattern.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(list.pattern, ""));
        index += 1;
      }
      blocks.push({ type: list.blockType, text: items.join("\n"), checked: false });
      continue;
    }

    const conversion = markdownConversion(trimmed);
    if (conversion) {
      blocks.push({ type: conversion.blockType, text: conversion.text, checked: conversion.checked === true });
      index += 1;
      continue;
    }

    // Consecutive plain lines are one paragraph, as in Markdown itself.
    const paragraph = [];
    while (index < lines.length && !startsNewBlock(lines[index].trim())) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join("\n"), checked: false });
  }

  return blocks;
}

const INLINE_MARK_PATTERN = /\*\*(?<bold>[^*]+)\*\*|\*(?<italic>[^*]+)\*|__(?<underline>[^_]+)__|~~(?<strike>[^~]+)~~|%%#(?<colorHex>[0-9a-fA-F]{6});(?<colorText>[^%]+)%%|\$(?<math>[^$\n]+)\$/g;

const INLINE_WRAP_MARKERS = Object.freeze({
  bold: "**",
  italic: "*",
  underline: "__",
  strike: "~~",
});

function tokenizeInlineMarks(text) {
  const nodes = [];
  let cursor = 0;
  INLINE_MARK_PATTERN.lastIndex = 0;
  let match;
  while ((match = INLINE_MARK_PATTERN.exec(text))) {
    if (match.index > cursor) nodes.push({ type: "text", value: text.slice(cursor, match.index) });
    const groups = match.groups;
    if (groups.bold !== undefined) nodes.push({ type: "bold", value: groups.bold });
    else if (groups.italic !== undefined) nodes.push({ type: "italic", value: groups.italic });
    else if (groups.underline !== undefined) nodes.push({ type: "underline", value: groups.underline });
    else if (groups.strike !== undefined) nodes.push({ type: "strike", value: groups.strike });
    else if (groups.colorText !== undefined) nodes.push({ type: "color", value: groups.colorText, color: `#${groups.colorHex}` });
    else if (groups.math !== undefined) nodes.push({ type: "math", value: groups.math });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) nodes.push({ type: "text", value: text.slice(cursor) });
  return nodes;
}

/**
 * Splits Block text into PageLink, math, and character-styling nodes for rendering.
 * Links are located first via their exact token strings; the remaining plain
 * segments are then scanned for **bold**, *italic*, __underline__, ~~strike~~,
 * %%#hex;color%%, and $inline-math$ markers.
 */
export function buildInlineNodes(text, links = []) {
  const value = String(text ?? "");
  if (!value) return [];
  const linkMatches = [];
  let cursor = 0;
  const sortedLinks = [...links].sort((a, b) => value.indexOf(a.token) - value.indexOf(b.token));
  for (const link of sortedLinks) {
    const index = value.indexOf(link.token, cursor);
    if (index < 0) continue;
    linkMatches.push({ index, end: index + link.token.length, link });
    cursor = index + link.token.length;
  }
  const nodes = [];
  let position = 0;
  for (const linkMatch of linkMatches) {
    if (linkMatch.index > position) nodes.push(...tokenizeInlineMarks(value.slice(position, linkMatch.index)));
    nodes.push({ type: "link", value: linkMatch.link.token.slice(2, -2), targetPageId: linkMatch.link.targetPageId });
    position = linkMatch.end;
  }
  if (position < value.length) nodes.push(...tokenizeInlineMarks(value.slice(position)));
  return nodes;
}

/**
 * Toggles a symmetric wrap marker (bold/italic/underline/strike) around the
 * selected range: wraps if not already wrapped, unwraps if it is.
 */
export function toggleInlineWrap(text, selectionStart, selectionEnd, mark) {
  const marker = INLINE_WRAP_MARKERS[mark];
  if (!marker) return null;
  const value = String(text ?? "");
  const start = Math.max(0, Math.min(value.length, selectionStart));
  const end = Math.max(start, Math.min(value.length, selectionEnd));
  if (start === end) return null;
  const before = value.slice(Math.max(0, start - marker.length), start);
  const after = value.slice(end, end + marker.length);
  if (before === marker && after === marker) {
    const nextText = value.slice(0, start - marker.length) + value.slice(start, end) + value.slice(end + marker.length);
    return { text: nextText, start: start - marker.length, end: end - marker.length };
  }
  const selected = value.slice(start, end);
  const nextText = `${value.slice(0, start)}${marker}${selected}${marker}${value.slice(end)}`;
  return { text: nextText, start: start + marker.length, end: start + marker.length + selected.length };
}

/** Wraps the selected range with a %%#hex;...%% text-color marker. */
export function applyColorWrap(text, selectionStart, selectionEnd, hex) {
  const value = String(text ?? "");
  const start = Math.max(0, Math.min(value.length, selectionStart));
  const end = Math.max(start, Math.min(value.length, selectionEnd));
  if (start === end || !/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  const open = `%%#${hex};`;
  const close = "%%";
  const selected = value.slice(start, end);
  const nextText = `${value.slice(0, start)}${open}${selected}${close}${value.slice(end)}`;
  return { text: nextText, start: start + open.length, end: start + open.length + selected.length };
}

export function isGroupedListType(blockType) {
  return groupedListTypes.has(blockType);
}

export function splitListItems(text) {
  return String(text ?? "").split(/\r?\n/);
}

export function groupedListEnter(text, selectionStart, selectionEnd = selectionStart) {
  const value = String(text ?? "");
  const start = Math.max(0, Math.min(value.length, selectionStart));
  const end = Math.max(start, Math.min(value.length, selectionEnd));
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = value.indexOf("\n", end);
  const lineEnd = nextBreak < 0 ? value.length : nextBreak;
  const currentLine = value.slice(lineStart, lineEnd);

  if (currentLine.trim()) {
    const nextText = `${value.slice(0, start)}\n${value.slice(end)}`;
    return { exitList: false, text: nextText, cursor: start + 1 };
  }

  const removeStart = lineStart > 0 ? lineStart - 1 : lineStart;
  const removeEnd = lineEnd < value.length ? lineEnd + 1 : lineEnd;
  const nextText = `${value.slice(0, removeStart)}${value.slice(removeEnd)}`;
  return { exitList: true, text: nextText, cursor: removeStart };
}
