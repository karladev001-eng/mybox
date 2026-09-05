/** Host-owned migration/compatibility adapter. All content access uses Knowledge Operations. */
export function createKnowledgeChatStore({ client, legacy, readLegacyImage, desktop = false }) {
  let checkpoint;
  const activeContexts = new Set();
  let previous = new Map();
  let queue = Promise.resolve();
  const invoke = (name, input) => client.invoke(`knowledge.${name}`, input);
  const serialize = (task) => { const run = queue.catch(() => {}).then(task); queue = run; return run; };
  async function readSession(projectId, pageId) {
    let offset = 0, session;
    do {
      const result = await invoke("conversation.read.v1", { projectId, pageId, offset, limit: 200 });
      if (!session) session = { ...result.session, messages: [] };
      session.messages.push(...result.session.messages);
      offset = result.nextOffset;
    } while (offset !== null);
    return session;
  }
  async function copyImage(image) {
    if (!image || image.appId === "knowledge") return image;
    const data = await readLegacyImage(image.resourceId);
    const resourceId = await client.storeImageBytes(data.replace(/^data:[^,]+,/, ""));
    const copied = await client.readImage(resourceId);
    if (copied.split(",").at(-1) !== data.split(",").at(-1)) throw new Error("画像の移行検証に失敗しました");
    return { ...image, resourceId, appId: "knowledge" };
  }
  async function prepareDefault() {
    const servers = desktop ? await client.listSyncEndpoints() : [];
    const { projects } = await client.listProjects();
    if (checkpoint?.projectId && projects.some((p) => p.id === checkpoint.projectId && p.role === "owner") && !servers.some((s) => s.projectId === checkpoint.projectId)) return checkpoint.projectId;
    // An explicit new local Project also avoids an existing Personal being shared.
    const { project } = await client.createProject("My Records");
    checkpoint = { ...checkpoint, projectId: project.id };
    await legacy.writeMigration(checkpoint);
    if (desktop) await client.ensureAppProjectStore(project.id, project.name);
    await client.prepareProjectSession(project.id);
    return project.id;
  }
  async function migrate() {
    checkpoint = await legacy.readMigration() || { version: 1, phase: "pending", mappings: {}, images: {} };
    await prepareDefault();
    if (checkpoint.phase === "complete") return;
    const raw = await legacy.readBackup() ?? await legacy.readRaw() ?? { version: 2, sessions: [] };
    if (!Array.isArray(raw.sessions)) throw new Error("旧会話データが不正です。元データは保持されています。");
    await legacy.backup(raw);
    for (let index = 0; index < raw.sessions.length; index++) {
      const source = raw.sessions[index];
      if (!source || !Array.isArray(source.messages)) throw new Error(`会話 ${index + 1} を移行できません`);
      let mapping = checkpoint.mappings[index];
      if (!mapping) {
        const { projects } = await client.listProjects();
        const pages = (await Promise.all(projects.map(async (project) => (await client.listPages(project.id, true)).pages))).flat();
        const proposed = source.id || `session-${crypto.randomUUID()}`;
        mapping = { id: pages.some((p) => p.id === proposed) ? `session-${crypto.randomUUID()}` : proposed, messageIds: source.messages.map((m, i) => m.id && !source.messages.slice(0, i).some((a) => a.id === m.id) ? m.id : `message-${crypto.randomUUID()}`) };
        checkpoint.mappings[index] = mapping;
        await legacy.writeMigration(checkpoint);
      }
      const session = { ...structuredClone(source), id: mapping.id, projectId: checkpoint.projectId };
      session.messages = [];
      for (let i = 0; i < source.messages.length; i++) {
        const message = { ...structuredClone(source.messages[i]), id: mapping.messageIds[i] };
        if (message.image) {
          const key = `${index}:${i}`;
          if (!checkpoint.images[key]) { checkpoint.images[key] = await copyImage(message.image); await legacy.writeMigration(checkpoint); }
          message.image = checkpoint.images[key];
        }
        session.messages.push(message);
      }
      await client.prepareProjectSession(checkpoint.projectId);
      await invoke("conversation.save.v1", { projectId: checkpoint.projectId, session, legacy: true });
      const saved = await readSession(checkpoint.projectId, session.id);
      const identityFields = new Set(["id", "projectId", "title", "messages", "revision", "createdAt", "updatedAt"]);
      if (Object.keys(source).some((key) => !identityFields.has(key) && JSON.stringify(saved[key]) !== JSON.stringify(source[key]))) throw new Error("会話メタデータの移行検証に失敗しました。旧データは保持されています。");
      if (JSON.stringify(saved.messages) !== JSON.stringify(session.messages)) {
        // Compare values independent of object insertion order.
        if (saved.messages.length !== session.messages.length || saved.messages.some((m, i) => Object.keys(session.messages[i]).some((key) => JSON.stringify(m[key]) !== JSON.stringify(session.messages[i][key])))) throw new Error("会話の移行検証に失敗しました。旧データは保持されています。");
      }
      mapping.verified = true;
      await legacy.writeMigration(checkpoint);
    }
    checkpoint.phase = "complete";
    await legacy.writeMigration(checkpoint);
  }
  async function load() {
    await migrate();
    const sessions = [];
    const unavailableProjects = [];
    const { projects } = await client.listProjects();
    for (const project of projects) {
      try { await client.prepareProjectSession(project.id); }
      catch (error) { unavailableProjects.push({ id: project.id, name: project.name, error: String(error.message || error) }); continue; }
      const { pages: allPages } = await client.listPages(project.id);
      for (const item of allPages.filter((p) => p.kind === "context" && !activeContexts.has(p.id))) {
        const { page } = await client.readPage(project.id, item.id);
        if (page.context?.version === 2 && !page.context.sharedCopy && project.role !== "viewer") {
          for (const block of page.blocks.filter((b) => b.turn?.status === "sending")) {
            if (!activeContexts.has(`${page.id}:${block.turn.messageId}`)) await invoke("context.finish.v2", { projectId: project.id, pageId: page.id, messageId: block.turn.messageId, status: "unknown" });
          }
        }
        if (["prepared", "sending"].includes(page.context?.status) && project.role !== "viewer") await invoke("context.finish.v1", { projectId: project.id, pageId: page.id, status: "unknown" });
      }
      let offset = 0;
      do {
        const result = await invoke("conversation.list.v1", { projectId: project.id, offset, limit: 200 });
        for (const page of result.pages) sessions.push(await readSession(project.id, page.id));
        offset = result.nextOffset;
      } while (offset !== null);
    }
    sessions.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    previous = new Map(sessions.map((s) => [s.id, structuredClone(s)]));
    return { version: 2, sessions, unavailableProjects };
  }
  return {
    client,
    load: () => serialize(load),
    defaultProject: () => serialize(prepareDefault),
    async contextDestination(conversationProjectId, conversationId) {
      const projectId = await serialize(prepareDefault);
      await client.prepareProjectSession(projectId);
      const { pages } = await client.listPages(projectId, true);
      for (const item of pages.filter((p) => p.kind === "context")) {
        const { page } = await client.readPage(projectId, item.id);
        if (page.context?.version === 2 && !page.context.sharedCopy && page.context.conversationId === conversationId && page.context.conversationProjectId === conversationProjectId) {
          if (page.state !== "active") throw new Error("Context PageがTrashにあります。復元してから送信してください。");
          return { projectId, contextId: page.id };
        }
      }
      return { projectId, contextId: `context-${crypto.randomUUID()}` };
    },
    async findContext(conversationProjectId, conversationId, messageId) {
      const { projects } = await client.listProjects();
      let legacy = null;
      for (const project of projects) {
        try { await client.prepareProjectSession(project.id); } catch { continue; }
        const { pages } = await client.listPages(project.id);
        for (const item of pages.filter((p) => p.kind === "context")) {
          const { page } = await client.readPage(project.id, item.id);
          if (page.context?.conversationId !== conversationId || (page.context.conversationProjectId ?? page.projectId) !== conversationProjectId) continue;
          if (page.context.version === 2 && page.blocks.some((b) => b.turn?.messageId === messageId)) return { projectId: project.id, pageId: page.id, blockId: `turn-${messageId}` };
          if (page.context.messageId === messageId) legacy = { projectId: project.id, pageId: page.id };
        }
      }
      if (legacy) {
        const destination = await this.contextDestination(conversationProjectId, conversationId);
        const { page } = await invoke("context.ensure.v2", { ...destination, conversationProjectId, conversationId });
        return { projectId: page.projectId, pageId: page.id, blockId: `legacy-${legacy.pageId}` };
      }
      return null;
    },
    copyImage,
    async readContextSources(projectId, refs) {
      return Promise.all(refs.map(async (ref) => {
        await client.prepareProjectSession(ref.projectId);
        const { page } = await client.readPage(ref.projectId, ref.pageId);
        if (page.state !== "active") throw new Error("Contextの参照元がTrashにあります");
        return { ...ref, revision: page.revision, title: page.title, text: page.blocks.filter((b) => !ref.blockId || b.id === ref.blockId).map((b) => b.text).join("\n\n") };
      }));
    },
    save: (history) => serialize(async () => {
      if (checkpoint?.phase !== "complete") throw new Error("会話の移行を完了してください");
      const sessions = [];
      for (const source of history.sessions) {
        const session = structuredClone(source);
        session.projectId ||= await prepareDefault();
        for (const m of session.messages) if (m.image && m.image.appId !== "knowledge") m.image = await copyImage(m.image);
        if (JSON.stringify(previous.get(session.id)) !== JSON.stringify(session)) {
          await client.prepareProjectSession(session.projectId);
          const result = await invoke("conversation.save.v1", { projectId: session.projectId, session });
          sessions.push(result.session);
        } else sessions.push(session);
      }
      // Deletion is based only on the last loaded view, never unseen concurrent Pages.
      for (const old of previous.values()) if (!sessions.some((s) => s.id === old.id)) {
        const { page } = await client.readPage(old.projectId, old.id);
        if (page.state === "active") await invoke("page.move-to-trash", { projectId: old.projectId, pageId: old.id, expectedRevision: page.revision });
      }
      previous = new Map(sessions.map((s) => [s.id, structuredClone(s)]));
      return { version: 2, sessions };
    }),
    capture: async (input) => { const result = await invoke("context.capture.v2", input); activeContexts.add(`${input.contextId}:${input.messageId}`); return result; },
    finish: async (input) => { const result = await invoke("context.finish.v2", input); activeContexts.delete(`${input.pageId}:${input.messageId}`); return result; },
  };
}
