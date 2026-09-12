/** Host orchestration: legacy owner ports and Knowledge Operations only. */
export function createKnowledgeImageStore({ client, readLegacyImage, materializeImage, getDefaultProject, desktop = false }) {
  let migration = null;
  let port;
  const strip = (value) => { const { knowledge, ...record } = structuredClone(value); return record; };
  const files = new Map();
  const activeAttempts = new Set();
  async function destination() {
    const projectId = await getDefaultProject();
    const { projects } = await client.listProjects();
    const project = projects.find((p) => p.id === projectId);
    const servers = desktop ? await client.listSyncEndpoints() : [];
    if (!project || project.role !== "owner" || servers.some((s) => s.projectId === projectId)) throw new Error("非共有のRecord Projectを選択してください");
    await client.prepareProjectSession(projectId);
    return projectId;
  }
  async function readFile(ref) {
    const file = await client.invoke("knowledge.file.read.v1", {projectId: ref.projectId, pageId: ref.pageId});
    return `data:${file.mediaType};base64,${file.base64}`;
  }
  async function copyImage(ref, projectId, checkpoint) {
    if (!ref?.resourceId) return ref;
    if (ref.appId === "knowledge" && ref.pageId) { files.set(ref.resourceId, ref); return ref; }
    const key = ref.resourceId;
    const mapping = checkpoint.images[key] ?? { projectId, pageId: `file-${crypto.randomUUID()}` };
    checkpoint.images[key] = mapping;
    await port.writeCheckpoint(checkpoint);
    const data = await readLegacyImage(ref.resourceId);
    if (!data) throw new Error("画像原本が見つかりません。移行を停止しました");
    const base64 = data.replace(/^data:[^,]+,/, "");
    await client.prepareProjectSession(mapping.projectId);
    const { page } = await client.invoke("knowledge.file.import.v1", {...mapping, fileId: mapping.pageId, name: ref.name || "Image.png", base64});
    const copy = { ...ref, ...mapping, appId: "knowledge", resourceId: `knowledge-file:${mapping.projectId}:${mapping.pageId}`, mediaType: page.file.mediaType, originalResource: {appId: ref.appId || "image-studio", resourceId: ref.resourceId} };
    if ((await readFile(copy)).split(",").at(-1) !== base64) throw new Error("画像の移行照合に失敗しました");
    files.set(copy.resourceId, copy);
    return copy;
  }
  async function all(kinds = ["prompt", "generation"]) {
    const result = {schemaVersion: 1, revision: 1, templates: [], generations: []};
    const { projects } = await client.listProjects();
    for (const project of projects) {
      await client.prepareProjectSession(project.id);
      const {pages} = await client.invoke("knowledge.image-record.list.v1", {projectId: project.id, kinds});
      for (const page of pages) {
        if (!page.imageRecord) continue;
        const record = {...structuredClone(page.imageRecord), state: page.state === "trash" ? "trash" : page.imageRecord.state === "trash" ? (page.kind === "prompt" ? "active" : page.imageRecord.resource ? "complete" : "unknown") : page.imageRecord.state,
          knowledge: {projectId: project.id, pageId: page.id, revision: page.revision, pageState: page.state, role: project.role}};
        for (const ref of [record.resource, ...(record.input?.references ?? [])]) if (ref?.appId === "knowledge") files.set(ref.resourceId, ref);
        result[page.kind === "prompt" ? "templates" : "generations"].push(record);
      }
    }
    for (const list of [result.templates, result.generations]) list.sort((a,b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return result;
  }
  async function write(value, kind, checkpoint, mapping, templates) {
    const record = strip(value);
    const projectId = mapping?.projectId ?? value.knowledge?.projectId ?? await destination();
    await client.prepareProjectSession(projectId);
    const pageId = mapping?.pageId ?? value.knowledge?.pageId ?? record.id;
    const links = [];
    if (kind === "generation") {
      if (record.input.promptSource) links.push({projectId:record.input.promptSource.projectId, pageId:record.input.promptSource.pageId});
      record.resource = await copyImage(record.resource, projectId, checkpoint);
      record.input.references = await Promise.all((record.input.references ?? []).map((ref) => copyImage(ref, projectId, checkpoint)));
      for (const ref of [record.resource, ...record.input.references]) if (ref?.pageId) links.push({projectId: ref.projectId, pageId: ref.pageId});
      const selected = new Set(Object.values(record.input.selections ?? {}).flat());
      const prompts = templates ?? (selected.size ? (await all(["prompt"])).templates : []);
      for (const prompt of prompts) if (selected.has(prompt.id)) links.push({projectId: prompt.knowledge.projectId, pageId: prompt.knowledge.pageId});
    }
    const {page} = await client.invoke("knowledge.image-record.save.v1", {projectId, pageId, kind, record, links: [...new Map(links.map((ref) => [`${ref.projectId}:${ref.pageId}`, ref])).values()],
      expectedRevision: value.knowledge?.revision ?? mapping?.revision ?? 0});
    return {...page.imageRecord, knowledge: {projectId, pageId, revision: page.revision, pageState: page.state}};
  }
  async function migrate(owner) {
    port = owner;
    const checkpoint = await port.readCheckpoint() ?? {version: 1, phase: "pending", mappings: {}, images: {}};
    if (checkpoint.phase === "complete") { await port.complete?.(); return; }
    const raw = await port.readBackup() ?? await port.readRaw() ?? {schemaVersion: 1, templates: [], generations: []};
    if (!Array.isArray(raw.templates) || !Array.isArray(raw.generations)) throw new Error("旧Image記録を読み込めません");
    await port.writeBackup(raw);
    checkpoint.projectId ??= await destination();
    await port.writeCheckpoint(checkpoint);
    const existingIds = new Set();
    for (const project of (await client.listProjects()).projects) {
      await client.prepareProjectSession(project.id);
      for (const page of (await client.listPages(project.id, true)).pages) existingIds.add(page.id);
    }
    const templates = (await all(["prompt"])).templates;
    for (const [kind, records] of [["prompt", raw.templates], ["generation", raw.generations]]) {
      for (let i=0; i<records.length; i++) {
        const record = records[i], key = `${kind}:${i}`;
        if (!record?.id) throw new Error("旧記録のIDを確認してください");
        let mapping = checkpoint.mappings[key];
        if (!mapping) {
          mapping = {projectId: checkpoint.projectId, pageId: existingIds.has(record.id) ? `${kind}-${crypto.randomUUID()}` : record.id};
          mapping.sourceId = record.id;
          mapping.recordId = records.slice(0, i).some((r) => r.id === record.id) ? mapping.pageId : record.id;
          checkpoint.mappings[key] = mapping;
          await port.writeCheckpoint(checkpoint);
        }
        const mappedRecord = {...record, id: mapping.recordId ?? record.id};
        const saved = await write(mappedRecord, kind, checkpoint, mapping, templates);
        existingIds.add(mapping.pageId);
        if (kind === "prompt") {
          const index = templates.findIndex((p) => p.knowledge.projectId === saved.knowledge.projectId && p.knowledge.pageId === saved.knowledge.pageId);
          if (index < 0) templates.push(saved); else templates[index] = saved;
        }
        // Compare every source field, including provider metadata; media is verified above.
        const source = strip(mappedRecord), actual = strip(saved);
        if (kind === "generation") {
          actual.resource = source.resource;
          actual.input.references = source.input.references ?? [];
          source.input.references ??= [];
        }
        if (JSON.stringify(source) !== JSON.stringify(actual)) throw new Error("移行した記録の照合に失敗しました");
        mapping.revision = saved.knowledge.revision;
        await port.writeCheckpoint(checkpoint);
      }
    }
    checkpoint.phase = "complete";
    await port.writeCheckpoint(checkpoint);
    await port.complete?.();
  }
  return {
    async load(owner) {
      if (!migration) migration = migrate(owner).finally(() => { migration = null; });
      await migration;
      const state = await all();
      const servers = desktop ? await client.listSyncEndpoints() : [];
      for (const record of state.generations) {
        if (record.state === "generating" && record.knowledge.role === "owner" && !servers.some((s) => s.projectId === record.knowledge.projectId) && !activeAttempts.has(record.id)) {
          const checkpoint = await port.readCheckpoint();
          const changed = {...record, state: "unknown", error: {code: "INTERRUPTED", message: "結果不明"}};
          Object.assign(record, await write(changed, "generation", checkpoint));
        }
      }
      return state;
    },
    async save(mutation) {
      const checkpoint = await port.readCheckpoint();
      const value = mutation.template ?? mutation.generation;
      if (!value) {
        const current = (await all()).generations.find((g) => g.id === mutation.id);
        if (current) await client.purgePage(current.knowledge.projectId, current.knowledge.pageId, current.knowledge.revision);
        return mutation;
      }
      const kind = mutation.template ? "prompt" : "generation";
      if (value.knowledge && ((value.state === "trash") !== (value.knowledge.pageState === "trash"))) {
        const {projectId, pageId, revision} = value.knowledge;
        await client.invoke(value.state === "trash" ? "knowledge.page.move-to-trash" : "knowledge.page.restore", {projectId, pageId, expectedRevision: revision});
        return {...mutation, [kind === "prompt" ? "template" : "generation"]: (await all())[kind === "prompt" ? "templates" : "generations"].find((r) => r.id === value.id)};
      }
      if (kind === "generation" && value.state === "generating") activeAttempts.add(value.id);
      let saved;
      try { saved = await write(value, kind, checkpoint); }
      catch (error) { if (!value.knowledge) activeAttempts.delete(value.id); throw error; }
      if (kind === "generation" && value.state !== "generating") activeAttempts.delete(value.id);
      return {...mutation, [kind === "prompt" ? "template" : "generation"]: saved};
    },
    async readResource(id) {
      const ref = files.get(id);
      if (!ref) throw new Error("画像を開き直してください");
      return readFile(ref);
    },
    async prepareReferences(references) {
      return Promise.all(references.map(async (ref) => ref.appId === "knowledge" && ref.pageId ? materializeImage((await readFile(ref)).split(",").at(-1)) : ref));
    },
  };
}
