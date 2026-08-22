function normalizeSearchText(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("ja-JP");
}

export function filterNotePageChoices(pages, tags, query = "") {
  const labelsById = new Map((tags ?? []).map((tag) => [tag.id, tag.label]));
  const terms = normalizeSearchText(query)
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(/^#+/, ""))
    .filter(Boolean);

  return (pages ?? []).map((page) => {
    const pageTags = (page.tagIds ?? []).map((tagId) => labelsById.get(tagId)).filter(Boolean);
    return { ...page, tags: pageTags };
  }).filter((page) => {
    if (!terms.length) return true;
    const title = normalizeSearchText(page.title);
    const tagLabels = page.tags.map(normalizeSearchText);
    return terms.every((term) => title.includes(term) || tagLabels.some((label) => label.includes(term)));
  });
}
