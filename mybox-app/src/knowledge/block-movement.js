/** Pure movement plan shared by local, collaborative and UI callers. */
export function planBlockMove(blocks, mutation) {
  const ids = blocks.map(block => typeof block === "string" ? block : block.id);
  const requested = mutation.type === "block-move" ? [mutation.blockId] : mutation.blockIds;
  if (!Array.isArray(requested) || !requested.length) throw new Error("INVALID_PAGE_MUTATION: At least one Block is required");
  const selected = new Set(requested);
  for (const id of selected) if (!ids.includes(id)) throw new Error(`BLOCK_NOT_FOUND: ${id}`);
  const ordered = [...ids];
  if (mutation.beforeBlockId !== undefined) {
    const anchor = mutation.beforeBlockId;
    if (anchor !== null && !ids.includes(anchor)) throw new Error(`BLOCK_NOT_FOUND: ${anchor}`);
    if (!selected.has(anchor)) {
      const moving = ids.filter(id => selected.has(id));
      const rest = ids.filter(id => !selected.has(id));
      rest.splice(anchor === null ? rest.length : rest.indexOf(anchor), 0, ...moving);
      ordered.splice(0, ordered.length, ...rest);
    }
  } else if (mutation.direction === "up") {
    for (let i = 1; i < ordered.length; i++) {
      if (selected.has(ordered[i]) && !selected.has(ordered[i - 1])) [ordered[i - 1], ordered[i]] = [ordered[i], ordered[i - 1]];
    }
  } else if (mutation.direction === "down") {
    for (let i = ordered.length - 2; i >= 0; i--) {
      if (selected.has(ordered[i]) && !selected.has(ordered[i + 1])) [ordered[i], ordered[i + 1]] = [ordered[i + 1], ordered[i]];
    }
  } else throw new Error("INVALID_PAGE_MUTATION: A movement destination is required");
  return { order: ordered, selectedIds: ids.filter(id => selected.has(id)), changed: ordered.some((id, i) => id !== ids[i]) };
}
