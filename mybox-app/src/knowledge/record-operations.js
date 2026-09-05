import { reconcileRecordLinks } from "./record-links.js";
import { authorize, saveConversation, captureContext, finishContext, extractRecord, conversationSession } from "./records.js";
import { listPages, readPage, normalizePageTitle, KnowledgeDomainError } from "./domain.js";
import { contextConversationLink, ensureNotebook, captureNotebook, finishNotebookTurn, notebookTurns, sharePreview, copySharedRecord } from "./context-records.js";

const schema = (required, properties = {}) => ({ type: "object", required, properties });
const string = { type: "string", minLength: 1 };
const inputs = { projectId: string, pageId: string, conversationId: string, messageId: string, contextId: string, callId: string, prompt: string, status: string, session: { type: "object" }, sources: { type: "array", items: { type: "object" } }, settings: { type: "object" }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 200 } };
export const recordOperations = [
  ["conversation.save", "会話を保存", "write", ["projectId", "session"]],
  ["conversation.create", "会話を作成", "write", ["projectId", "session"]],
  ["conversation.append", "会話に発言を追加", "write", ["projectId", "session"]],
  ["conversation.list", "会話を一覧", "read", ["projectId"]],
  ["conversation.read", "会話履歴を読む", "read", ["projectId", "pageId"]],
  ["context.capture", "送信Contextを記録", "write", ["projectId", "conversationId", "messageId", "contextId", "prompt"]],
  ["context.finish", "送信結果を記録", "write", ["projectId", "pageId", "status"]],
  ["record.links", "記録のPageLinkを整備", "write", ["projectId", "pageId"]],
  ["record.extract", "出典付きNoteを作成", "write", ["projectId", "pageId"]],
].map(([id, title, effect, required]) => ({ id: `knowledge.${id}.v1`, title, effect, confirmationClass: effect === "read" ? "review" : "autonomous", callers: id.startsWith("context.") || id === "conversation.save" ? ["user"] : ["user", "agent", "flow", "app"], inputSchema: schema(required, inputs), outputSchema: { type: "object" } }));
recordOperations.push(...[
  ["context.ensure.v2", "会話のContext Pageを用意", "write", ["projectId", "conversationProjectId", "conversationId", "contextId"]],
  ["context.capture.v2", "Recordに送信Contextを記録", "write", ["projectId", "conversationProjectId", "conversationId", "messageId", "contextId", "callId", "prompt"]],
  ["context.finish.v2", "送信回の結果を記録", "write", ["projectId", "pageId", "messageId", "status"]],
  ["context.read.v2", "Contextの送信回を読む", "read", ["projectId", "pageId"]],
  ["context.share-preview.v2", "共有する記録を確認", "read", ["projectId", "pageId", "targetProjectId", "turnIds"]],
  ["context.share-copy.v2", "選択した記録を共有先へコピー", "write", ["projectId", "pageId", "targetProjectId", "turnIds", "previewToken", "copyId"]],
].map(([id, title, effect, required]) => ({ id: `knowledge.${id}`, title, effect, confirmationClass: "review", callers: ["user"], inputSchema: schema(required, { ...inputs, conversationProjectId: string, targetProjectId: string, copyId: string, previewToken: string, turnIds: { type: "array", minItems: 1, items: string } }), outputSchema: { type: "object" } })));

/** Overlay live Project data for search/records without persisting it to App-common state. */
export function withProjectSessions(state, sharedSessions, profileId) {
  const next = structuredClone(state);
  for (const project of next.projects) {
    const session = sharedSessions.get(project.id);
    if (!session) continue;
    if (!session.role) {
      next.pages = next.pages.filter((p) => p.projectId !== project.id);
      project.members = [];
      continue;
    }
    next.pages = next.pages.filter((p) => p.projectId !== project.id);
    next.pages.push(...session.listPages(true).map((p) => {
      const page = session.readPage(p.id).page;
      return { ...page, normalizedTitle: normalizePageTitle(page.title), createdAt: page.createdAt ?? "", updatedAt: page.updatedAt ?? "" };
    }));
    next.tags = next.tags.filter((tag) => tag.projectId !== project.id);
    next.tags.push(...session.listTags());
    // A live transport supplies the effective membership (including joined Projects).
    if (session.role) project.members = [{ profileId, role: session.role }];
  }
  return next;
}

export function createRecordHandlers({ loadState, sharedSessions }) {
  let queue = Promise.resolve();
  const mutations = { "conversation.save": saveConversation, "conversation.create": saveConversation, "conversation.append": saveConversation, "context.capture": captureContext, "context.finish": finishContext, "record.links": reconcileRecordLinks, "record.extract": extractRecord };
  Object.assign(mutations, { "context.ensure.v2": ensureNotebook, "context.capture.v2": captureNotebook, "context.finish.v2": finishNotebookTurn, "context.share-copy.v2": copySharedRecord });
  const handlers = {};
  for (const [name, mutate] of Object.entries(mutations)) {
    handlers[`knowledge.${name}${name.endsWith(".v2") ? "" : ".v1"}`] = (input, ctx) => {
      const run = queue.catch(() => {}).then(async () => {
        const profileId = ctx.actor.type === "user" ? ctx.actor.id : ctx.actor.profileId || "local-user";
        const stored = await loadState(ctx.storage);
        const state = withProjectSessions(stored, sharedSessions, profileId);
        const existing = state.pages.find((p) => p.id === input.session?.id);
        if (name === "conversation.create" && existing) throw new KnowledgeDomainError("RECORD_ID_CONFLICT", "Conversation already exists");
        if (name === "conversation.append" && !existing) throw new KnowledgeDomainError("PAGE_NOT_FOUND", "Conversation does not exist");
        if (name === "record.links") authorize(state, input.projectId, profileId, true);
        const result = await mutate(state, input, profileId, ctx.resources);
        const linked = reconcileRecordLinks(result.state, { projectId: result.page.projectId, pageId: result.page.id }, profileId);
        result.page = linked.page;
        const changed = linked.state.pages.filter((page) => JSON.stringify(page) !== JSON.stringify(state.pages.find((p) => p.id === page.id)));
        const local = changed.filter((page) => !sharedSessions.get(page.projectId));
        if (local.length) {
          const ids = new Set(local.map((page) => page.id));
          stored.pages = [...stored.pages.filter((page) => !ids.has(page.id)), ...local];
          await ctx.storage.writeJson("state.json", stored);
        }
        for (const page of changed) {
          const session = sharedSessions.get(page.projectId);
          if (session) { session.commitRecord(page); await session.flush(); }
        }
        for (const page of changed) await ctx.emit("knowledge.page.changed", { projectId: page.projectId, pageId: page.id, revision: page.revision, state: page.state });
        return { page: result.page, ...(result.session ? { session: result.session } : {}) };
      });
      queue = run;
      return run;
    };
  }
  for (const name of ["context.read.v2", "context.share-preview.v2"]) handlers[`knowledge.${name}`] = async (input, ctx) => {
    const profileId = ctx.actor.id;
    const state = withProjectSessions(await loadState(ctx.storage), sharedSessions, profileId);
    return name === "context.read.v2" ? { turns: notebookTurns(state, input, profileId), conversationLink: contextConversationLink(state, input, profileId) } : sharePreview(state, input, profileId);
  };
  handlers["knowledge.conversation.list.v1"] = async ({ projectId, offset = 0, limit = 50 }, ctx) => {
    const profileId = ctx.actor.type === "user" ? ctx.actor.id : ctx.actor.profileId || "local-user";
    const state = withProjectSessions(await loadState(ctx.storage), sharedSessions, profileId);
    const pages = listPages(state, { projectId, profileId }).filter((p) => p.kind === "conversation");
    return { pages: pages.slice(offset, offset + limit), nextOffset: offset + limit < pages.length ? offset + limit : null };
  };
  handlers["knowledge.conversation.read.v1"] = async ({ projectId, pageId, offset = 0, limit = 100 }, ctx) => {
    const profileId = ctx.actor.type === "user" ? ctx.actor.id : ctx.actor.profileId || "local-user";
    const state = withProjectSessions(await loadState(ctx.storage), sharedSessions, profileId);
    const page = readPage(state, { projectId, pageId, profileId });
    if (page.kind !== "conversation") throw new KnowledgeDomainError("INVALID_CONVERSATION", "Page is not a conversation");
    const session = conversationSession(page);
    return { session: { ...session, messages: session.messages.slice(offset, offset + limit) }, nextOffset: offset + limit < session.messages.length ? offset + limit : null };
  };
  return handlers;
}
