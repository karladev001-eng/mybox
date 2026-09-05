import { createPage, readPage, normalizePageTitle, KnowledgeDomainError } from "./domain.js";

export const RECORD_VERSION = 1;
export const PAGE_KINDS = Object.freeze(["note", "conversation", "context"]);
const clone = (value) => structuredClone(value);
const fail = (code, message) => { throw new KnowledgeDomainError(code, message); };
const id = (prefix) => `${prefix}-${crypto.randomUUID()}`;

export function uniqueRecordTitle(pages, projectId, title, exceptId) {
  const base = (title || "新しいチャット").trim().slice(0, 200);
  let result = base;
  for (let n = 2; pages.some((p) => p.projectId === projectId && p.id !== exceptId && normalizePageTitle(p.title) === normalizePageTitle(result)); n++) result = `${base} (${n})`;
  return result;
}

export function authorize(state, projectId, profileId, write) {
  const project = state.projects.find((p) => p.id === projectId);
  const role = project?.members.find((m) => m.profileId === profileId)?.role;
  if (!role || (write && role === "viewer")) fail("PROJECT_ROLE_REQUIRED", write ? "Editor Project role is required" : "Viewer Project role is required");
}

export function recordPage(state, input, kind, profileId) {
  const result = createPage(state, {
    projectId: input.projectId, title: uniqueRecordTitle(state.pages, input.projectId, input.title), profileId,
    idFactory: (prefix) => prefix === "page" && input.id ? input.id : id(prefix),
  });
  if (state.pages.some((p) => p.id === result.page.id)) fail("RECORD_ID_CONFLICT", "Record ID is already in use");
  const page = result.state.pages.find((p) => p.id === result.page.id);
  page.kind = kind;
  page.recordVersion = RECORD_VERSION;
  page.blocks = [];
  return { state: result.state, page };
}

export function conversationSession(page) {
  return {
    ...clone(page.sessionMetadata ?? {}),
    id: page.id, projectId: page.projectId, title: page.title, revision: page.revision ?? 0,
    createdAt: page.createdAt, updatedAt: page.updatedAt,
    messages: page.blocks.filter((b) => b.message).map((b) => ({ ...clone(b.message), id: b.id, content: b.text })),
  };
}

/** One writer transaction. Existing message bodies cannot be changed by a save. */
export function saveConversation(state, { projectId, session, legacy = false }, profileId) {
  authorize(state, projectId, profileId, true);
  if (!session || typeof session.id !== "string" || !Array.isArray(session.messages)) fail("INVALID_CONVERSATION", "Conversation ID and messages are required");
  let next = clone(state);
  let page = next.pages.find((p) => p.id === session.id);
  if (page && (page.projectId !== projectId || page.kind !== "conversation")) fail("RECORD_ID_CONFLICT", "Conversation ID is already in use");
  if (page?.revision && session.revision !== undefined && session.revision !== page.revision) fail("REVISION_CONFLICT", "Conversation changed; reload before saving");
  if (!page) ({ state: next, page } = recordPage(next, { projectId, id: session.id, title: session.title }, "conversation", profileId));
  if (page.state !== "active") fail("PAGE_IN_TRASH", "Restore the conversation before continuing");
  const seen = new Set();
  for (const message of session.messages) {
    if (!message || !message.id || typeof message.content !== "string" || !["user", "assistant"].includes(message.role) || seen.has(message.id)) fail("INVALID_MESSAGE", "Message identity, role and text must be valid");
    seen.add(message.id);
    const existing = page.blocks.find((b) => b.id === message.id);
    if (existing) {
      const { id: ignored, content, ...metadata } = message;
      if (existing.text !== content || existing.message.role !== metadata.role) fail("IMMUTABLE_RECORD", "Recorded messages cannot be edited");
      continue;
    }
    const { id: blockId, content, ...metadata } = clone(message);
    page.blocks.push({ id: blockId, type: "paragraph", text: content, checked: false, revision: 1, links: [], message: metadata });
  }
  page.title = uniqueRecordTitle(next.pages, projectId, session.title, page.id);
  page.normalizedTitle = normalizePageTitle(page.title);
  page.createdAt = session.createdAt || page.createdAt;
  page.updatedAt = session.updatedAt || new Date().toISOString();
  page.revision = (page.revision || 0) + 1;
  if (legacy) page.legacyContextUnavailable = true;
  if (legacy && !page.sessionMetadata) {
    const { id: ignoredId, projectId: ignoredProject, title: ignoredTitle, messages: ignoredMessages, revision: ignoredRevision, ...metadata } = clone(session);
    page.sessionMetadata = metadata;
  }
  return { state: next, page: clone(page), session: conversationSession(page) };
}

export function captureContext(state, input, profileId) {
  authorize(state, input.projectId, profileId, true);
  const conversation = readPage(state, { ...input, pageId: input.conversationId, profileId });
  if (conversation.kind !== "conversation" || conversation.state !== "active") fail("INVALID_CONVERSATION", "An active conversation is required");
  if (!conversation.blocks.some((b) => b.id === input.messageId && b.message?.role === "user")) fail("MESSAGE_NOT_FOUND", "The user message must be saved first");
  if (typeof input.prompt !== "string" || !input.prompt) fail("INVALID_CONTEXT", "The exact outbound prompt is required");
  const sourceRefs = (state.pages.some((p) => p.id === input.contextId) ? [] : input.sources ?? []).map((ref) => {
    if (ref.projectId !== input.projectId) fail("CONTEXT_PROJECT_MISMATCH", "Context must stay in the conversation Project");
    const source = readPage(state, { ...ref, profileId });
    if (source.state !== "active") fail("PAGE_IN_TRASH", "Context source is in Trash");
    const blocks = ref.blockId ? source.blocks.filter((b) => b.id === ref.blockId) : source.blocks;
    if (!blocks.length) fail("BLOCK_NOT_FOUND", "Context source Block was not found");
    if (ref.text !== undefined && ref.text !== blocks.map((b) => b.text).join("\n\n")) fail("REVISION_CONFLICT", "Context source changed before send; select it again");
    return { projectId: input.projectId, pageId: source.id, pageRevision: source.revision, title: source.title, blocks: blocks.map((b) => ({ id: b.id, revision: b.revision ?? 0, text: b.text })) };
  });
  let next = clone(state);
  let page = next.pages.find((p) => p.id === input.contextId);
  if (!page) {
    ({ state: next, page } = recordPage(next, { projectId: input.projectId, id: input.contextId, title: `Context · ${conversation.title} · ${new Date().toISOString()}` }, "context", profileId));
    page.context = { conversationId: conversation.id, messageId: input.messageId, status: "prepared", sources: sourceRefs };
  }
  if (page.projectId !== input.projectId || page.kind !== "context" || page.context.conversationId !== conversation.id || page.context.messageId !== input.messageId) fail("INVALID_CONTEXT", "Context does not belong to this turn");
  if (!["prepared", "sending"].includes(page.context.status)) fail("IMMUTABLE_RECORD", "Completed Context cannot be changed");
  const callId = input.callId || id("call");
  const existing = page.blocks.find((b) => b.id === callId);
  if (existing && existing.text !== input.prompt) fail("IMMUTABLE_RECORD", "Call input cannot be changed");
  if (!existing) page.blocks.push({ id: callId, type: "code", text: input.prompt, checked: false, revision: 1, links: [], call: { createdAt: new Date().toISOString(), settings: clone(input.settings ?? {}) } });
  page.context.status = "sending";
  page.revision = (page.revision || 0) + 1;
  page.updatedAt = new Date().toISOString();
  return { state: next, page: clone(page) };
}

export function finishContext(state, input, profileId) {
  authorize(state, input.projectId, profileId, true);
  const next = clone(state);
  const page = next.pages.find((p) => p.id === input.pageId && p.projectId === input.projectId);
  if (page?.kind !== "context" || !["complete", "error", "interrupted", "unknown"].includes(input.status)) fail("INVALID_CONTEXT", "Invalid Context outcome");
  if (!["prepared", "sending", input.status].includes(page.context.status)) fail("IMMUTABLE_RECORD", "Context outcome is final");
  page.context.status = input.status;
  page.revision = (page.revision || 0) + 1;
  return { state: next, page: clone(page) };
}

export function extractRecord(state, input, profileId) {
  authorize(state, input.projectId, profileId, true);
  const source = readPage(state, { ...input, profileId });
  const blocks = input.blockId ? source.blocks.filter((b) => b.id === input.blockId) : source.blocks;
  if (!blocks.length || source.state !== "active") fail("BLOCK_NOT_FOUND", "Active source content is required");
  const { state: next, page } = recordPage(state, { projectId: input.projectId, title: input.title || `${source.title} · Note` }, "note", profileId);
  page.provenance = { projectId: input.projectId, pageId: source.id, pageRevision: source.revision, blockIds: blocks.map((b) => b.id) };
  page.blocks = blocks.map((b) => ({ id: id("block"), type: "paragraph", text: b.text, checked: false, revision: 1, links: [] }));
  page.blocks.push({ id: id("block"), type: "paragraph", text: `出典: [[${source.title}]]`, checked: false, revision: 1, links: [{ targetPageId: source.id, token: `[[${source.title}]]` }] });
  return { state: next, page: clone(page) };
}
