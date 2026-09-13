const fields = block => ({ id: block.id, type: block.type, text: block.text, checked: block.checked === true,
  links: (block.links ?? []).map(link => ({ targetPageId: link.targetPageId, token: link.token })) });
export const documentProjection = blocks => blocks.map(fields);
export const sameDocument = (a, b) => JSON.stringify(documentProjection(a)) === JSON.stringify(documentProjection(b));

/** Compare before writing. A document transaction never overwrites unseen edits. */
export function planDocumentEdit(current, base, next, { types, actorId, canLink = () => false } = {}) {
  for (const list of [base, next]) {
    if (!Array.isArray(list) || !list.length || list.length > 10000) throw new Error("INVALID_DOCUMENT_EDIT: Document Blocks are required");
    const seen = new Set();
    for (const block of list) {
      if (!block || typeof block.id !== "string" || !block.id || seen.has(block.id) || !types.includes(block.type) || typeof block.text !== "string") throw new Error("INVALID_DOCUMENT_EDIT: Invalid Block");
      seen.add(block.id);
    }
  }
  const byId = new Map(current.map(block => [block.id, block]));
  const before = new Map(base.map(block => [block.id, block]));
  const after = new Map(next.map(block => [block.id, block]));
  const structural = base.map(b => b.id).join("\0") !== next.map(b => b.id).join("\0");
  const conflict = () => { throw new Error("DOCUMENT_EDIT_CONFLICT: 本文が別の操作で更新されました。入力内容をコピーしてからNoteを閉じて開き直し、最新の本文と照合してください。"); };
  if (structural && current.map(b => b.id).join("\0") !== base.map(b => b.id).join("\0")) conflict();
  for (const old of base) {
    const replacement = after.get(old.id);
    if ((!replacement || !sameDocument([old], [replacement])) && (!byId.has(old.id) || !sameDocument([old], [byId.get(old.id)]))) conflict();
  }
  for (const block of next) if (!before.has(block.id) && byId.has(block.id)) conflict();
  const source = structural ? next : current.map(block => after.get(block.id) ?? block);
  return source.map(block => {
    const old = before.get(block.id), existing = byId.get(block.id);
    if (old && sameDocument([old], [block])) return existing ?? conflict();
    if (!old && existing) return existing;
    const links = (block.links ?? []).filter(link => typeof link.token === "string" && block.text.includes(link.token) && canLink(link.targetPageId))
      .map(link => existing?.links?.find(item => item.targetPageId === link.targetPageId && item.token === link.token) ?? { targetPageId: link.targetPageId, token: link.token });
    return { ...existing, id: block.id, type: block.type, text: block.text, checked: block.checked === true,
      links, revision: (Number(existing?.revision) || 0) + 1, updatedBy: actorId };
  });
}
