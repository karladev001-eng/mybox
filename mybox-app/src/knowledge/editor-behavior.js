const groupedListTypes = new Set(["bulleted-list", "numbered-list"]);

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
  return null;
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
