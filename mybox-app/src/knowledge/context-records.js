import { isRecordLinkBlock } from "./record-links.js";
import { authorize, recordPage } from "./records.js";
import { readPage, KnowledgeDomainError } from "./domain.js";

const fail = (code, text) => { throw new KnowledgeDomainError(code, text); };
const copy = (value) => structuredClone(value);
const block = (id, text, metadata) => ({ id, type: "paragraph", text, checked: false, revision: 1, links: [], ...metadata });
const terminal = ["complete", "error", "interrupted", "unknown"];

/** Resolve the persisted relation for both existing and newly recorded Context. */
export function contextConversationLink(state, input, profileId) {
  const page = readPage(state, { ...input, profileId });
  if (page.kind !== "context") fail("INVALID_CONTEXT", "A Context Page is required");
  let context = page.context;
  if (context?.sharedCopy && !context.conversationId && page.provenance?.pageId) {
    try { const source = readPage(state, { projectId: page.provenance.projectId, pageId: page.provenance.pageId, profileId }); context = { ...source.context, conversationProjectId: source.context?.conversationProjectId ?? source.projectId }; }
    catch { return null; }
  }
  if (!context?.conversationId) return null;
  const link = { projectId: context.conversationProjectId ?? page.projectId, pageId: context.conversationId };
  try {
    const conversation = readPage(state, { ...link, profileId });
    if (conversation.kind !== "conversation" || conversation.state !== "active") return { ...link, title: "元のセッション会話", available: false };
    return { ...link, title: conversation.title, available: true };
  } catch { return { ...link, title: "元のセッション会話", available: false }; }
}

export function ensureNotebook(state, input, profileId) {
  authorize(state, input.projectId, profileId, true);
  const conversation = readPage(state, { projectId: input.conversationProjectId, pageId: input.conversationId, profileId });
  if (conversation.kind !== "conversation" || conversation.state !== "active") fail("INVALID_CONVERSATION", "An active conversation and saved user message are required");
  let next = copy(state), page = next.pages.find((p) => p.id === input.contextId);
  if (!page) {
    if (next.pages.some((p) => p.projectId === input.projectId && p.context?.version === 2 && !p.context.sharedCopy && p.context.conversationProjectId === conversation.projectId && p.context.conversationId === conversation.id)) fail("CONTEXT_EXISTS", "Reload the existing Context notebook before sending");
    ({ state: next, page } = recordPage(next, { projectId: input.projectId, id: input.contextId, title: `Context · ${conversation.title}` }, "context", profileId));
    page.recordVersion = 2;
    page.context = { version: 2, conversationProjectId: conversation.projectId, conversationId: conversation.id, legacy: [] };
  }
  if (page.projectId !== input.projectId || page.state !== "active" || page.context?.version !== 2 || page.context.sharedCopy || page.context.conversationId !== conversation.id || page.context.conversationProjectId !== conversation.projectId) fail("INVALID_CONTEXT", "Restore or select the original Context notebook");
  // Keep legacy IDs rather than copying the old prompts into the notebook.
  for (const old of state.pages.filter((p) => p.kind === "context" && !p.context?.version && p.context?.conversationId === conversation.id && p.projectId === conversation.projectId)) {
    authorize(state, old.projectId, profileId, false);
    if (!page.context.legacy.some((ref) => ref.pageId === old.id)) page.context.legacy.push({ projectId: old.projectId, pageId: old.id, messageId: old.context.messageId });
  }
  return { state: next, page };
}

export function captureNotebook(state, input, profileId) {
  const { state: next, page } = ensureNotebook(state, input, profileId);
  const conversation = readPage(state, { projectId: input.conversationProjectId, pageId: input.conversationId, profileId });
  const message = conversation.blocks.find((b) => b.id === input.messageId && b.message?.role === "user");
  if (!message || typeof input.prompt !== "string" || !input.prompt) fail("INVALID_CONTEXT", "Saved user message and exact input are required");
  let turn = page.blocks.find((b) => b.turn?.messageId === input.messageId);
  if (!turn) {
    const sources = (input.sources ?? []).map((ref) => {
      const source = readPage(state, { projectId: ref.projectId, pageId: ref.pageId, profileId });
      const blocks = source.blocks.filter((b) => !ref.blockId || b.id === ref.blockId);
      if (source.state !== "active" || !blocks.length) fail("SOURCE_UNAVAILABLE", "Context source is unavailable");
      if (ref.text !== blocks.map((b) => b.text).join("\n\n")) fail("REVISION_CONFLICT", "Context source changed before sending");
      return { projectId: source.projectId, pageId: source.id, pageRevision: source.revision, title: source.title, blocks: blocks.map((b) => ({ id: b.id, revision: b.revision ?? 0, text: b.text })) };
    });
    turn = block(`turn-${input.messageId}`, message.text, { turn: { messageId: input.messageId, createdAt: message.message.createdAt, status: "sending", sources } });
    page.blocks.push(turn);
  }
  if (terminal.includes(turn.turn.status)) fail("IMMUTABLE_RECORD", "Completed turn cannot be changed");
  const previous = page.blocks.find((b) => b.id === input.callId);
  const call = { messageId: input.messageId, createdAt: new Date().toISOString(), settings: copy(input.settings ?? {}) };
  if (previous && (previous.text !== input.prompt || previous.call?.messageId !== input.messageId || JSON.stringify(previous.call.settings) !== JSON.stringify(call.settings))) fail("IMMUTABLE_RECORD", "Call input cannot be changed");
  if (!previous) page.blocks.push(block(input.callId, input.prompt, { type: "code", call }));
  page.revision = (page.revision || 0) + 1;
  page.updatedAt = new Date().toISOString();
  return { state: next, page: copy(page) };
}

export function finishNotebookTurn(state, input, profileId) {
  authorize(state, input.projectId, profileId, true);
  const next = copy(state);
  const page = next.pages.find((p) => p.projectId === input.projectId && p.id === input.pageId);
  const turn = page?.blocks.find((b) => b.turn?.messageId === input.messageId);
  if (page?.state !== "active" || page.context?.sharedCopy || !turn || !terminal.includes(input.status)) fail("INVALID_CONTEXT", "Context turn is unavailable");
  if (terminal.includes(turn.turn.status) && turn.turn.status !== input.status) fail("IMMUTABLE_RECORD", "Turn outcome is final");
  turn.turn.status = input.status;
  page.revision = (page.revision || 0) + 1;
  return { state: next, page: copy(page) };
}

export function notebookTurns(state, input, profileId) {
  const page = readPage(state, { ...input, profileId });
  if (page.kind !== "context") fail("INVALID_CONTEXT", "A Context Page is required");
  if (page.context?.sharedCopy) return page.blocks.filter((b) => b.turn).map((b) => ({ id: b.id, ...copy(b.turn), question: b.text, calls: page.blocks.filter((c) => c.call?.messageId === b.turn.messageId), answers: page.blocks.filter((a) => a.message?.replyTo === b.turn.messageId).map((a) => ({ ...a.message, id: a.id, content: a.text })) }));
  let conversation;
  try { conversation = readPage(state, { projectId: page.context.conversationProjectId ?? page.projectId, pageId: page.context.conversationId, profileId }); } catch { /* Saved inputs remain readable without the original. */ }
  const answers = (messageId) => {
    const blocks = conversation?.blocks ?? [];
    const start = blocks.findIndex((b) => b.id === messageId);
    const end = blocks.findIndex((b, i) => i > start && b.message?.role === "user");
    const legacyIds = new Set(start < 0 ? [] : blocks.slice(start + 1, end < 0 ? undefined : end).filter((b) => !b.message?.replyTo).map((b) => b.id));
    return blocks.filter((b) => b.message?.role === "assistant" && (b.message.replyTo === messageId || legacyIds.has(b.id))).map((b) => ({ ...copy(b.message), id: b.id, content: b.text }));
  };
  const turns = page.blocks.filter((b) => b.turn).map((b) => ({ id: b.id, ...copy(b.turn), question: b.text, calls: copy(page.blocks.filter((c) => c.call?.messageId === b.turn.messageId)), answers: answers(b.turn.messageId), conversationAvailable: !!conversation && conversation.state === "active" }));
  const legacy = page.context.version === 2 ? page.context.legacy ?? [] : [{ projectId: page.projectId, pageId: page.id }];
  for (const ref of legacy) {
    try {
      const old = readPage(state, { ...ref, profileId });
      const messageId = old.context.messageId;
      turns.push({ id: `legacy-${old.id}`, messageId, question: conversation?.blocks.find((b) => b.id === messageId)?.text ?? old.title, createdAt: old.createdAt, status: old.context.status, sources: copy(old.context.sources ?? []), calls: copy(old.blocks.filter((block) => !isRecordLinkBlock(block))), answers: answers(messageId), legacy: ref, conversationAvailable: !!conversation && conversation.state === "active" });
    } catch { turns.push({ id: `legacy-${ref.pageId}`, legacy: ref, unavailable: true, question: "旧Contextを参照できません" }); }
  }
  return turns.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
}

export async function sharePreview(state, input, profileId) {
  authorize(state, input.targetProjectId, profileId, true);
  if (input.targetProjectId === input.projectId) fail("INVALID_DESTINATION", "Choose a different shared Project");
  const page = readPage(state, { ...input, profileId });
  const all = notebookTurns(state, input, profileId);
  const turns = all.filter((turn) => input.turnIds?.includes(turn.id));
  if (!turns.length || new Set(input.turnIds).size !== turns.length || turns.some((t) => t.unavailable || !terminal.includes(t.status) || t.conversationAvailable === false)) fail("INVALID_SELECTION", "Select completed turns with an accessible conversation");
  const snapshot = { source: { projectId: page.projectId, pageId: page.id, revision: page.revision }, targetProjectId: input.targetProjectId, title: `${page.title} · 共有`, turns };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(snapshot)));
  return { ...snapshot, token: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("") };
}

export async function copySharedRecord(state, input, profileId, resources) {
  authorize(state, input.targetProjectId, profileId, true);
  readPage(state, { ...input, profileId });
  const existing = state.pages.find((p) => p.id === input.copyId);
  if (existing) {
    if (existing.projectId !== input.targetProjectId || existing.provenance?.shareToken !== input.previewToken) fail("RECORD_ID_CONFLICT", "Copy ID already exists");
    return { state, page: copy(existing) };
  }
  const preview = await sharePreview(state, input, profileId);
  if (preview.token !== input.previewToken) fail("REVISION_CONFLICT", "Record changed; preview again before sharing");
  const { state: next, page } = recordPage(state, { projectId: input.targetProjectId, id: input.copyId, title: preview.title }, "context", profileId);
  page.recordVersion = 2;
  const conversationLink = contextConversationLink(state, input, profileId);
  page.context = { version: 2, sharedCopy: true, ...(conversationLink ? { conversationProjectId: conversationLink.projectId, conversationId: conversationLink.pageId } : {}) };
  page.provenance = { ...preview.source, shareToken: preview.token };
  for (const turn of preview.turns) {
    page.blocks.push(block(`turn-${turn.messageId}`, turn.question, { turn: { messageId: turn.messageId, createdAt: turn.createdAt, status: turn.status, sources: copy(turn.sources) } }));
    for (const call of turn.calls) page.blocks.push({ ...copy(call), id: `${turn.id}-${call.id}`, call: { ...call.call, messageId: turn.messageId } });
    for (const answer of turn.answers) {
      const { id, content, ...message } = copy(answer);
      if (message.image && !message.image.dataUrl) {
        const image = message.image;
        const base64 = await resources.read({ ...image, appId: image.appId ?? "knowledge", revision: image.revision ?? 1 });
        if (!base64 || !/^[A-Za-z0-9+/=\r\n]+$/.test(base64)) fail("IMAGE_UNAVAILABLE", "Image copy failed");
        message.image = { ...image, dataUrl: `data:${image.mediaType};base64,${base64}` };
      }
      if (message.image && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(message.image.dataUrl)) fail("IMAGE_UNAVAILABLE", "Only copied raster images can be shared");
      page.blocks.push(block(`${turn.id}-${id}`, content, { message: { ...message, replyTo: turn.messageId } }));
    }
  }
  return { state: next, page: copy(page) };
}
