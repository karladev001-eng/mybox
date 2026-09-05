import { readPage } from "./domain.js";
import { authorize } from "./records.js";

export const isRecordLinkBlock = (block) => block.links?.length > 0 && block.links.every((link) => link.recordRelation);

/** Append ordinary PageLinks separately from immutable messages and model inputs. */
export function reconcileRecordLinks(state, input, profileId) {
  readPage(state, { ...input, profileId });
  const next = structuredClone(state);
  const can = (projectId, write) => { try { authorize(next, projectId, profileId, write); return true; } catch { return false; } };
  const connect = (source, ref, relation) => {
    if (!source || source.state !== "active" || !can(source.projectId, true)) return;
    const target = next.pages.find((p) => p.id === ref.pageId && p.projectId === ref.projectId && p.state === "active");
    if (!target || target.id === source.id || !can(target.projectId, false)) return;
    if (source.blocks.some((b) => b.links.some((l) => l.targetPageId === target.id && (l.targetProjectId ?? source.projectId) === target.projectId))) return;
    const token = `[[${target.title}]]`;
    source.blocks.push({ id: `record-link-${encodeURIComponent(target.projectId)}-${encodeURIComponent(target.id)}`, type: "paragraph", text: token, checked: false, revision: 1,
      links: [{ targetPageId: target.id, targetProjectId: target.projectId, token, recordRelation: relation }] });
  };
  for (const page of next.pages) {
    if (page.kind !== "context" || !can(page.projectId, false)) continue;
    const context = page.context ?? {};
    const refs = [...(context.sources ?? []), ...page.blocks.flatMap((b) => b.turn?.sources ?? [])];
    if (page.id !== input.pageId && !(context.conversationId === input.pageId && (context.conversationProjectId ?? page.projectId) === input.projectId) && !refs.some((ref) => ref.projectId === input.projectId && ref.pageId === input.pageId)) continue;
    const conversation = { projectId: context.conversationProjectId ?? page.projectId, pageId: context.conversationId };
    connect(page, conversation, "conversation");
    // Never publish the existence of private Record Pages into another Project.
    // Cross-Project reverse navigation is provided by authorized backlinks.
    if (!context.sharedCopy && conversation.projectId === page.projectId) {
      connect(next.pages.find((p) => p.id === conversation.pageId && p.projectId === conversation.projectId), { projectId: page.projectId, pageId: page.id }, "context");
    }
    for (const ref of context.legacy ?? []) connect(page, ref, "legacy-context");
    for (const ref of refs) connect(page, ref, "source");
    if (page.provenance?.pageId) connect(page, page.provenance, "source-record");
  }
  return { state: next, page: next.pages.find((p) => p.id === input.pageId && p.projectId === input.projectId) };
}

export function recordPageLinks(state, input, profileId) {
  const page = readPage(state, { ...input, profileId });
  const seen = new Set();
  return page.blocks.flatMap((b) => b.links).filter((link) => link.recordRelation).flatMap((link) => {
    const projectId = link.targetProjectId ?? page.projectId;
    const key = JSON.stringify([projectId, link.targetPageId]);
    if (seen.has(key)) return [];
    seen.add(key);
    try {
      const target = readPage(state, { projectId, pageId: link.targetPageId, profileId });
      if (target.state !== "active") return [];
      return [{ projectId, pageId: target.id, title: target.title, relation: link.recordRelation }];
    } catch { return []; }
  });
}
