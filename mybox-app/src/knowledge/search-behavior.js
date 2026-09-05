const normalize = (value) => String(value ?? "").trim().normalize("NFKC").toLocaleLowerCase("ja-JP");

export function filterPageSearchCandidates(pages, query, limit = 12) {
  const needle = normalize(query), terms = needle.split(/\s+/).filter(Boolean);
  return (pages ?? [])
    .filter((page) => !needle || normalize(page.matchedQuery) === needle || terms.every((term) => normalize(`${page.title} ${page.excerpt} ${(page.tagLabels ?? []).join(" ")}`).includes(term)))
    .sort((a, b) => Number(normalize(b.title) === needle) - Number(normalize(a.title) === needle))
    .slice(0, limit);
}

export function pageSearchKeyAction(event, activeIndex, candidateCount) {
  if (event?.isComposing || event?.nativeEvent?.isComposing || event?.keyCode === 229) return null;
  const count = Math.max(0, Number(candidateCount) || 0);
  const current = Math.min(Math.max(Number(activeIndex) || 0, 0), Math.max(count - 1, 0));

  if (event?.key === "Escape") return { type: "close" };
  if (!count) return null;
  if (event?.key === "Enter") return { type: "open", index: current };
  if (event?.key === "Home") return { type: "move", index: 0 };
  if (event?.key === "End") return { type: "move", index: count - 1 };
  if (event?.key === "ArrowDown") {
    return { type: "move", index: (current + 1) % count };
  }
  if (event?.key === "ArrowUp") {
    return { type: "move", index: (current - 1 + count) % count };
  }
  return null;
}

/** Search Project names alongside Pages; creation is a settled empty-result action. */
export function knowledgeSearchCommands(projects, currentProject, query, pageCount = 0, settled = true) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const matches = projects.filter((project) => terms.every((term) => normalize(project.name).includes(term)))
    .map((project) => ({ id: `project-${project.id}`, command: "project", projectId: project.id, title: project.name, excerpt: project.id === currentProject?.id ? "現在のProject" : "Project" }));
  if (!matches.length && !pageCount && settled && terms.length && currentProject && currentProject.role !== "viewer") {
    return [{ id: "create-page", command: "create", newTitle: query.trim(), title: `「${query.trim()}」を新しいPageとして作成`, excerpt: currentProject.name }];
  }
  return matches;
}
