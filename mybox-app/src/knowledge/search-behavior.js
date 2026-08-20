const normalize = (value) => String(value ?? "").trim().normalize("NFKC").toLocaleLowerCase("ja-JP");

export function filterPageSearchCandidates(pages, query, limit = 7) {
  const needle = normalize(query);
  if (!needle) return [];
  return (pages ?? [])
    .filter((page) => normalize(page?.title).includes(needle) || normalize(page?.excerpt).includes(needle))
    .slice(0, limit);
}

export function pageSearchKeyAction(event, activeIndex, candidateCount) {
  const count = Math.max(0, Number(candidateCount) || 0);
  const current = Math.min(Math.max(Number(activeIndex) || 0, 0), Math.max(count - 1, 0));

  if (event?.key === "Escape") return { type: "close" };
  if (!count) return null;
  if (event?.key === "Enter") return { type: "open", index: current };
  if (event?.key === "Home") return { type: "move", index: 0 };
  if (event?.key === "End") return { type: "move", index: count - 1 };
  if (event?.key === "ArrowDown" || (event?.key === "Tab" && !event.shiftKey)) {
    return { type: "move", index: (current + 1) % count };
  }
  if (event?.key === "ArrowUp" || (event?.key === "Tab" && event.shiftKey)) {
    return { type: "move", index: (current - 1 + count) % count };
  }
  return null;
}
