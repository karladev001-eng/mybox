const normalize = (value) => String(value ?? "").trim().normalize("NFKC").toLocaleLowerCase("ja");

export function isTagCommitKey(event) {
  if (!event || event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return false;
  return event.key === " "
    || event.key === "　"
    || event.key === "Spacebar"
    || event.code === "Space"
    || event.key === "Enter"
    || event.key === ",";
}

/** Input/composition events reveal delimiters that keydown may not expose through an IME. */
export function hasTagDelimiterAtEnd(value) {
  return /[\s\u3000,]$/u.test(String(value ?? ""));
}

/** Space, full-width Space, comma, and line breaks all delimit pasted or typed Tags. */
export function splitTagDraft(value) {
  return String(value ?? "").split(/[\s\u3000,]+/u).map((label) => label.trim()).filter(Boolean);
}

export function filterUsedTagCandidates(candidates, selectedLabels, draft, limit = 8) {
  const selected = new Set((selectedLabels ?? []).map(normalize));
  const needle = normalize(draft);
  return (candidates ?? [])
    .filter((tag) => Number(tag?.pageCount) > 0)
    .filter((tag) => !selected.has(normalize(tag.label)))
    .filter((tag) => !needle || normalize(tag.label).includes(needle))
    .slice(0, limit);
}
