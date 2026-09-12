import { recordPage, authorize } from "./records.js";
import { KnowledgeDomainError } from "./domain.js";
const fail = (code, message) => { throw new KnowledgeDomainError(code, message); };

export function saveImageRecord(state, input, profileId) {
  authorize(state, input.projectId, profileId, true);
  const { record, kind, pageId, expectedRevision = 0 } = input;
  if (!["prompt", "generation"].includes(kind) || !record?.id || typeof record.id !== "string") fail("INVALID_IMAGE_RECORD", "記録を確認してください");
  if (kind === "prompt" && (typeof record.prompt !== "string" || !record.name)) fail("INVALID_IMAGE_RECORD", "Promptを確認してください");
  if (kind === "generation" && (typeof record.finalPrompt !== "string" || !record.input)) fail("INVALID_IMAGE_RECORD", "生成入力を確認してください");
  let next = structuredClone(state), page = next.pages.find((p) => p.id === pageId);
  if (page && (page.projectId !== input.projectId || page.kind !== kind || page.imageRecord?.id !== record.id)) fail("RECORD_ID_CONFLICT", "Page IDが使用されています");
  // Idempotent retries never create an extra revision.
  if (page && JSON.stringify(page.imageRecord) === JSON.stringify(record)) return { state, page };
  if (page?.state === "trash") fail("PAGE_IN_TRASH", "記録を復元してください");
  if ((page?.revision ?? 0) !== expectedRevision) fail("REVISION_CONFLICT", "記録が更新されています。開き直してください");
  if (kind === "generation" && page && !["generating", "prepared"].includes(page.imageRecord.state)) fail("IMMUTABLE_RECORD", "完了した生成記録は変更できません");
  if (kind === "generation" && page && (record.finalPrompt !== page.imageRecord.finalPrompt || JSON.stringify(record.input) !== JSON.stringify(page.imageRecord.input))) fail("IMMUTABLE_RECORD", "送信済みの入力は変更できません");
  if (!page) ({state: next, page} = recordPage(next, {projectId: input.projectId, id: pageId, title: kind === "prompt" ? record.name : (record.input.subject || record.finalPrompt).slice(0, 100)}, kind, profileId));
  page.imageRecord = structuredClone(record);
  page.state = record.state === "trash" ? "trash" : "active";
  page.createdAt = record.createdAt || page.createdAt;
  page.updatedAt = record.updatedAt || new Date().toISOString();
  page.revision = (page.revision ?? 0) + 1;
  page.blocks = [{ id: `${page.id}-prompt`, type: "paragraph", text: kind === "prompt" ? record.prompt : record.finalPrompt, checked: false, revision: page.revision, links: [] }];
  if (kind === "generation") {
    page.blocks.push({id: `${page.id}-settings`, type: "code", text: JSON.stringify(record.input, null, 2), checked: false, revision: 1, links: []});
    for (const ref of input.links ?? []) {
      const target = next.pages.find((p) => p.projectId === ref.projectId && p.id === ref.pageId);
      authorize(next, ref.projectId, profileId, false);
      if (!target) fail("PAGE_NOT_FOUND", "参照先のPageがありません");
      const token = `[[${target.title}]]`;
      page.blocks.push({id: `${page.id}-link-${target.id}`, type: "paragraph", text: token, checked: false, revision: 1,
        links: [{targetPageId: target.id, targetProjectId: target.projectId, token, recordRelation: "generation-source"}]});
    }
  }
  return {state: next, page};
}
