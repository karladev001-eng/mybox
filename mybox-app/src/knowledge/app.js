import { LOCAL_PROFILE_ID } from "../core/account-identity.js";
import { APP_SCHEMA_VERSION, defineApp } from "../core/app-contract.js";
import {
  adoptLocalMemberships,
  BLOCK_TYPES,
  createKnowledgeState,
  createPage,
  createProject,
  deleteProject,
  getBacklinks,
  getProjectTags,
  KnowledgeDomainError,
  listPages,
  listProjectMembers,
  listProjects,
  movePageToTrash,
  purgePage,
  readPage,
  readPageHistory,
  renameProject,
  restorePage,
  restorePageHistory,
  searchPages,
  setProjectMemberColor,
  updatePage,
  validateKnowledgeState,
} from "./domain.js";

const STATE_KEY = "state.json";
const CONNECTION_DELIVERIES_KEY = "connection-deliveries.json";
const objectSchema = { type: "object" };
const actorCallers = ["user", "agent", "flow", "app"];

function profileIdFor(actor) {
  return actor.type === "user" ? actor.id : LOCAL_PROFILE_ID;
}

async function loadState(storage) {
  const stored = await storage.readJson(STATE_KEY);
  if (stored) return validateKnowledgeState(stored);
  const state = createKnowledgeState();
  await storage.writeJson(STATE_KEY, state);
  return state;
}

async function saveMutation(storage, mutation) {
  await storage.writeJson(STATE_KEY, mutation.state);
  return mutation;
}

function operation({ id, title, effect, confirmationClass, callers = actorCallers, inputSchema = objectSchema }) {
  return {
    id,
    title,
    effect,
    confirmationClass,
    callers,
    inputSchema,
    outputSchema: objectSchema,
  };
}

function blockToMarkdown(block) {
  const text = block.text ?? "";
  if (block.type === "heading-1") return `# ${text}`;
  if (block.type === "heading-2") return `## ${text}`;
  if (block.type === "heading-3") return `### ${text}`;
  if (block.type === "bullet-list") return text.split("\n").map((line) => `- ${line}`).join("\n");
  if (block.type === "number-list") return text.split("\n").map((line, index) => `${index + 1}. ${line}`).join("\n");
  if (block.type === "checklist") return text.split("\n").map((line) => `- [${block.checked ? "x" : " "}] ${line}`).join("\n");
  if (block.type === "quote") return text.split("\n").map((line) => `> ${line}`).join("\n");
  if (block.type === "code") return `\`\`\`\n${text}\n\`\`\``;
  if (block.type === "divider") return "---";
  return text;
}

function pageMarkdown(page) { return page.blocks.filter((block) => block.type !== "image").map(blockToMarkdown).filter(Boolean).join("\n\n"); }

const projectInput = {
  type: "object",
  required: ["projectId"],
  properties: { projectId: { type: "string", minLength: 1 } },
};

const pageInput = {
  type: "object",
  required: ["projectId", "pageId"],
  properties: {
    projectId: { type: "string", minLength: 1 },
    pageId: { type: "string", minLength: 1 },
  },
};

const revisionInput = {
  type: "object",
  required: ["projectId", "pageId", "expectedRevision"],
  properties: {
    projectId: { type: "string", minLength: 1 },
    pageId: { type: "string", minLength: 1 },
    // A shared Project's Pages report revision 0: a CRDT converges instead of
    // rejecting, so there is no revision to conflict on. A stale revision on a
    // local Page is still caught by the domain's own check.
    expectedRevision: { type: "integer", minimum: 0 },
  },
};

/**
 * An Operation's input schema is the only description of a Page mutation an
 * agent ever sees (`agent-runtime.js` serialises it into the prompt), so the
 * vocabulary is spelled out here rather than left as an opaque object. It stays
 * permissive about the per-type fields — one schema cannot describe seven
 * variants without a union, which Structured Outputs disallows — so `type` is
 * the only hard requirement and the description carries the rest.
 */
const pageMutationInput = {
  type: "object",
  required: ["type"],
  properties: {
    type: {
      type: "string",
      enum: ["rename", "markdown-set", "block-add", "block-update", "block-paste", "block-remove", "block-move", "tags-set", "link-add"],
    },
    markdown: { type: "string" },
    mode: { type: "string", enum: ["append", "replace"] },
    title: { type: "string" },
    blockId: { type: "string" },
    afterBlockId: { type: ["string", "null"] },
    beforeBlockId: { type: ["string", "null"] },
    blockType: { type: "string", enum: [...BLOCK_TYPES] },
    text: { type: "string" },
    sourceText: { type: "string" },
    selectionStart: { type: "integer", minimum: 0 },
    selectionEnd: { type: "integer", minimum: 0 },
    checked: { type: "boolean" },
    labels: { type: "array", items: { type: "string" } },
    targetPageId: { type: "string" },
    createTitle: { type: "string" },
  },
  description: [
    "Fields depend on type:",
    "rename → title.",
    "block-add → afterBlockId (the Block to insert after, or null for the end), blockType, text.",
    "block-update → blockId, and any of text, blockType, checked.",
    "block-paste → blockId, text (clipboard text), sourceText, selectionStart, and selectionEnd; Markdown and hard line breaks become typed Blocks.",
    "block-remove → blockId.",
    "block-move → blockId, beforeBlockId (the Block to insert before, or null for the end).",
    "tags-set → labels, the complete replacement list.",
    "link-add → blockId, then either targetPageId for an existing Page or createTitle to create one.",
    "An image Block's text is a stored resource ID and cannot be authored here; a url-embed Block's text is the URL.",
    // Writing a document one block-add at a time exhausts the agent's step
    // budget, so it settles for a single Block holding a hand-drawn document.
    // markdown-set is the way to write prose: one call, split here.
    "markdown-set → markdown (a whole Markdown document) and optional mode (\"append\", the default, or \"replace\" to rewrite the Page). Prefer this over repeated block-add whenever you are writing more than one Block: MyBox parses the Markdown into properly typed Blocks for you.",
    "It understands #/##/### headings, - and 1. lists, - [ ] checklists, > quotes, ``` code fences, --- dividers, $$ math, and bare URLs, plus **bold**, *italic*, __underline__, ~~strike~~ and $inline math$.",
    "A Page is a list of Blocks, not one long text, so never hand-draw headings or bullets with characters like ■ or ・ inside a single Block's text.",
  ].join(" "),
};

/**
 * A shared Project is edited through its Yjs document rather than the JSON
 * store ([ADR 0023](../../../docs/adr/0023-user-operated-sync-servers-with-yjs.md)).
 * That document needs a live socket, so it cannot be built here; the client
 * injects the live session as a port instead. Keeping it behind the Operation
 * boundary is what stops the assistant and the editor from having two separate
 * write paths, where a write through one is invisible to the other.
 *
 * `get(projectId)` returns the live session or null when the Project is local.
 */
const noSharedSessions = Object.freeze({ get: () => null });

export function createKnowledgeApp({ sharedSessions = noSharedSessions } = {}) {
  return defineApp({
    manifest: {
      schemaVersion: APP_SCHEMA_VERSION,
      id: "knowledge",
      name: "Note",
      version: "0.1.4",
      hostCapabilities: ["app-storage"],
      operations: [
        operation({ id: "knowledge.project.list", title: "Projectを一覧", effect: "read", confirmationClass: "review", inputSchema: objectSchema }),
        operation({ id: "knowledge.project.members.list", title: "Projectメンバー色を一覧", effect: "read", confirmationClass: "review", inputSchema: projectInput }),
        operation({
          id: "knowledge.project.member-color.set",
          title: "Projectメンバーの基本色を設定",
          effect: "write",
          confirmationClass: "recoverable",
          callers: ["user"],
          inputSchema: {
            type: "object",
            required: ["projectId", "profileId", "color"],
            properties: {
              projectId: { type: "string", minLength: 1 },
              profileId: { type: "string", minLength: 1 },
              color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
            },
          },
        }),
        operation({
          id: "knowledge.project.create",
          title: "Projectを作成",
          effect: "write",
          confirmationClass: "always-confirm",
          callers: ["user", "agent"],
          inputSchema: {
            type: "object",
            required: ["name"],
            properties: { name: { type: "string", minLength: 1, maxLength: 120 } },
          },
        }),
        operation({
          id: "knowledge.project.rename",
          title: "Projectをリネーム",
          effect: "write",
          confirmationClass: "recoverable",
          callers: ["user"],
          inputSchema: {
            type: "object",
            required: ["projectId", "name"],
            properties: {
              projectId: { type: "string", minLength: 1 },
              name: { type: "string", minLength: 1, maxLength: 120 },
            },
          },
        }),
        operation({
          id: "knowledge.project.delete",
          title: "Projectを削除",
          effect: "destructive",
          confirmationClass: "autonomous",
          callers: ["user"],
          inputSchema: projectInput,
        }),
        operation({ id: "knowledge.page.list", title: "Pageを一覧", effect: "read", confirmationClass: "review", inputSchema: projectInput }),
        operation({ id: "knowledge.page.read", title: "Pageを読む", effect: "read", confirmationClass: "review", inputSchema: pageInput }),
        operation({
          id: "knowledge.page.search",
          title: "Pageを検索",
          effect: "read",
          confirmationClass: "review",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
              projectIds: { type: "array", items: { type: "string" } },
              includeTrash: { type: "boolean" },
            },
          },
        }),
        operation({ id: "knowledge.page.backlinks", title: "被リンクを読む", effect: "read", confirmationClass: "review", inputSchema: pageInput }),
        operation({
          id: "knowledge.page.create",
          title: "Pageを作成",
          effect: "write",
          confirmationClass: "recoverable",
          inputSchema: {
            type: "object",
            required: ["projectId", "title"],
            properties: {
              projectId: { type: "string", minLength: 1 },
              title: { type: "string", minLength: 1, maxLength: 240 },
            },
          },
        }),
        operation({
          id: "knowledge.page.update",
          title: "Pageを更新",
          effect: "write",
          confirmationClass: "recoverable",
          inputSchema: {
            ...revisionInput,
            required: [...revisionInput.required, "mutation"],
            properties: { ...revisionInput.properties, mutation: pageMutationInput },
          },
        }),
        operation({ id: "knowledge.page.move-to-trash", title: "PageをTrashへ移動", effect: "write", confirmationClass: "recoverable", inputSchema: revisionInput }),
        operation({ id: "knowledge.page.restore", title: "Pageを復元", effect: "write", confirmationClass: "recoverable", inputSchema: revisionInput }),
        operation({ id: "knowledge.page.purge", title: "Pageを完全削除", effect: "destructive", confirmationClass: "autonomous", callers: ["user", "agent"], inputSchema: revisionInput }),
        operation({ id: "knowledge.page.history.read", title: "Page履歴を読む", effect: "read", confirmationClass: "review", inputSchema: pageInput }),
        operation({
          id: "knowledge.page.history.restore",
          title: "Page履歴を復元",
          effect: "write",
          confirmationClass: "recoverable",
          inputSchema: {
            ...revisionInput,
            required: [...revisionInput.required, "historyId"],
            properties: { ...revisionInput.properties, historyId: { type: "string", minLength: 1 } },
          },
        }),
        operation({ id: "knowledge.tag.list", title: "Tagを一覧", effect: "read", confirmationClass: "review", inputSchema: projectInput }),
        operation({ id: "knowledge.connector.options", title: "Connection設定候補を一覧", effect: "read", confirmationClass: "review", inputSchema: objectSchema }),
        operation({ id: "knowledge.prompt-fragments.list", title: "Tag付きMarkdown Pageを取得", effect: "read", confirmationClass: "review", inputSchema: { type: "object", required: ["config"], properties: { config: { type: "object" } } } }),
        operation({ id: "knowledge.generated-image.consume", title: "生成画像からPageを作成", effect: "write", confirmationClass: "recoverable", inputSchema: { type: "object", required: ["item", "config", "deliveryId"], properties: { item: { type: "object" }, config: { type: "object" }, deliveryId: { type: "string" }, source: { type: "object" } } } }),
        operation({
          id: "knowledge.profile.link-account",
          title: "ローカルProjectにアカウントを紐付け",
          effect: "write",
          confirmationClass: "recoverable",
          callers: ["user"],
          inputSchema: {
            type: "object",
            required: ["accountId"],
            properties: { accountId: { type: "string", minLength: 1, maxLength: 160 } },
          },
        }),
      ],
      events: [
        {
          id: "knowledge.project.created",
          title: "Projectが作成された",
          payloadSchema: {
            type: "object",
            required: ["projectId"],
            properties: { projectId: { type: "string" } },
          },
        },
        {
          id: "knowledge.project.deleted",
          title: "Projectが削除された",
          payloadSchema: {
            type: "object",
            required: ["projectId"],
            properties: { projectId: { type: "string" } },
          },
        },
        {
          id: "knowledge.page.changed",
          title: "Pageが変更された",
          payloadSchema: {
            type: "object",
            required: ["projectId", "pageId", "revision", "state"],
            properties: {
              projectId: { type: "string" },
              pageId: { type: "string" },
              revision: { type: "integer" },
              state: { enum: ["active", "trash"] },
            },
          },
        },
        {
          id: "knowledge.page.purged",
          title: "Pageが完全削除された",
          payloadSchema: {
            type: "object",
            required: ["projectId", "pageId"],
            properties: {
              projectId: { type: "string" },
              pageId: { type: "string" },
            },
          },
        },
      ],
      connectors: {
        sources: [{ id: "knowledge.tagged-markdown", title: "Tag付きMarkdown Page", mode: "pull", dataType: "mybox.prompt-fragment.v1", operationId: "knowledge.prompt-fragments.list", optionsOperationId: "knowledge.connector.options", configSchema: { type: "object", required: ["projectId", "publishTag", "worldTag", "styleTag", "compositionTag", "moodTag"], properties: { projectId: { type: "string", title: "Project", format: "mybox-project" }, publishTag: { type: "string", title: "公開用Tag", format: "mybox-tag" }, worldTag: { type: "string", title: "世界観Tag", format: "mybox-tag" }, styleTag: { type: "string", title: "画風Tag", format: "mybox-tag" }, compositionTag: { type: "string", title: "用途・構図Tag", format: "mybox-tag" }, moodTag: { type: "string", title: "雰囲気Tag", format: "mybox-tag" } } } }],
        targets: [{ id: "knowledge.generated-image-pages", title: "画像Pageを作成", mode: "consume", dataType: "mybox.generated-image.v1", operationId: "knowledge.generated-image.consume", optionsOperationId: "knowledge.connector.options", configSchema: { type: "object", required: ["projectId"], properties: { projectId: { type: "string", title: "出力Project", format: "mybox-project" }, pageTag: { type: "string", title: "Page Tag", format: "mybox-tag" } } } }],
      },
    },
    handlers: {
      async "knowledge.project.list"(_input, { actor, storage }) {
        const state = await loadState(storage);
        return { projects: listProjects(state, { profileId: profileIdFor(actor) }) };
      },
      async "knowledge.project.members.list"({ projectId }, { actor, storage }) {
        const session = sharedSessions.get(projectId);
        if (session) return { members: session.listMemberColors() };
        return { members: listProjectMembers(await loadState(storage), { projectId, profileId: profileIdFor(actor) }) };
      },
      async "knowledge.project.member-color.set"({ projectId, profileId, color }, { actor, storage }) {
        const session = sharedSessions.get(projectId);
        if (session) return { member: session.setMemberColor(profileId, color, actor.id) };
        const mutation = await saveMutation(storage, setProjectMemberColor(await loadState(storage), {
          projectId,
          memberProfileId: profileId,
          color,
          profileId: profileIdFor(actor),
        }));
        return { member: mutation.member };
      },
      async "knowledge.project.create"({ name }, { actor, storage, emit }) {
        const mutation = await saveMutation(storage, createProject(await loadState(storage), {
          name,
          profileId: profileIdFor(actor),
        }));
        await emit("knowledge.project.created", { projectId: mutation.project.id });
        return { project: mutation.project };
      },
      async "knowledge.project.rename"({ projectId, name }, { actor, storage }) {
        const mutation = await saveMutation(storage, renameProject(await loadState(storage), {
          projectId,
          name,
          profileId: profileIdFor(actor),
        }));
        return { project: mutation.project };
      },
      async "knowledge.project.delete"({ projectId }, { actor, storage, emit }) {
        const mutation = await saveMutation(storage, deleteProject(await loadState(storage), {
          projectId,
          profileId: profileIdFor(actor),
        }));
        await emit("knowledge.project.deleted", { projectId: mutation.projectId });
        return { projectId: mutation.projectId };
      },
      async "knowledge.page.list"({ projectId, includeTrash = false }, { actor, storage }) {
        const session = sharedSessions.get(projectId);
        if (session) return { pages: session.listPages() };
        const state = await loadState(storage);
        return { pages: listPages(state, { projectId, includeTrash, profileId: profileIdFor(actor) }) };
      },
      async "knowledge.page.read"({ projectId, pageId }, { actor, storage }) {
        const session = sharedSessions.get(projectId);
        if (session) {
          const shared = session.readPage(pageId);
          if (!shared) throw new KnowledgeDomainError("PAGE_NOT_FOUND", "Page was not found", { pageId });
          return shared;
        }
        const state = await loadState(storage);
        const profileId = profileIdFor(actor);
        const page = readPage(state, { projectId, pageId, profileId });
        const tags = getProjectTags(state, { projectId, profileId }).filter((tag) => page.tagIds.includes(tag.id));
        const backlinks = getBacklinks(state, { projectId, pageId, profileId });
        return { page, tags, backlinks };
      },
      async "knowledge.page.search"({ query = "", projectIds, includeTrash = false }, { actor, storage }) {
        const state = await loadState(storage);
        return { results: searchPages(state, { query, projectIds, includeTrash, profileId: profileIdFor(actor) }) };
      },
      async "knowledge.page.backlinks"({ projectId, pageId }, { actor, storage }) {
        const state = await loadState(storage);
        return { backlinks: getBacklinks(state, { projectId, pageId, profileId: profileIdFor(actor) }) };
      },
      async "knowledge.page.create"({ projectId, title }, { actor, storage, emit }) {
        const mutation = await saveMutation(storage, createPage(await loadState(storage), {
          projectId,
          title,
          profileId: profileIdFor(actor),
          actorId: actor.id,
        }));
        await emit("knowledge.page.changed", {
          projectId,
          pageId: mutation.page.id,
          revision: mutation.page.revision,
          state: mutation.page.state,
        });
        return { page: mutation.page };
      },
      async "knowledge.page.update"(input, { actor, storage, emit }) {
        // A shared Project converges through its document instead of the JSON
        // store, and carries no revision to conflict on.
        const session = sharedSessions.get(input.projectId);
        if (session) {
          session.mutate(input.pageId, input.mutation, actor.id);
          const shared = session.readPage(input.pageId);
          await emit("knowledge.page.changed", {
            projectId: input.projectId,
            pageId: input.pageId,
            revision: shared.page.revision,
            state: shared.page.state,
          });
          return { page: shared.page };
        }
        const mutation = await saveMutation(storage, updatePage(await loadState(storage), {
          ...input,
          profileId: profileIdFor(actor),
          actorId: actor.id,
        }));
        await emit("knowledge.page.changed", {
          projectId: input.projectId,
          pageId: mutation.page.id,
          revision: mutation.page.revision,
          state: mutation.page.state,
        });
        return { page: mutation.page };
      },
      async "knowledge.page.move-to-trash"(input, { actor, storage, emit }) {
        const mutation = await saveMutation(storage, movePageToTrash(await loadState(storage), {
          ...input,
          profileId: profileIdFor(actor),
          actorId: actor.id,
        }));
        await emit("knowledge.page.changed", {
          projectId: input.projectId,
          pageId: mutation.page.id,
          revision: mutation.page.revision,
          state: mutation.page.state,
        });
        return { page: mutation.page };
      },
      async "knowledge.page.restore"(input, { actor, storage, emit }) {
        const mutation = await saveMutation(storage, restorePage(await loadState(storage), {
          ...input,
          profileId: profileIdFor(actor),
          actorId: actor.id,
        }));
        await emit("knowledge.page.changed", {
          projectId: input.projectId,
          pageId: mutation.page.id,
          revision: mutation.page.revision,
          state: mutation.page.state,
        });
        return { page: mutation.page };
      },
      async "knowledge.page.purge"(input, { actor, storage, emit }) {
        const mutation = await saveMutation(storage, purgePage(await loadState(storage), {
          ...input,
          profileId: profileIdFor(actor),
          actorId: actor.id,
        }));
        await emit("knowledge.page.purged", { projectId: input.projectId, pageId: mutation.pageId });
        return { pageId: mutation.pageId, releasedTitle: mutation.releasedTitle };
      },
      async "knowledge.page.history.read"({ projectId, pageId }, { actor, storage }) {
        const state = await loadState(storage);
        return { entries: readPageHistory(state, { projectId, pageId, profileId: profileIdFor(actor) }) };
      },
      async "knowledge.page.history.restore"(input, { actor, storage, emit }) {
        const mutation = await saveMutation(storage, restorePageHistory(await loadState(storage), {
          ...input,
          profileId: profileIdFor(actor),
          actorId: actor.id,
        }));
        await emit("knowledge.page.changed", {
          projectId: input.projectId,
          pageId: mutation.page.id,
          revision: mutation.page.revision,
          state: mutation.page.state,
        });
        return { page: mutation.page };
      },
      async "knowledge.tag.list"({ projectId }, { actor, storage }) {
        const state = await loadState(storage);
        return { tags: getProjectTags(state, { projectId, profileId: profileIdFor(actor) }) };
      },
      async "knowledge.connector.options"(_input, { actor, storage }) {
        const state = await loadState(storage);
        const projects = listProjects(state, { profileId: profileIdFor(actor) });
        return { projects: projects.map((project) => ({ id: project.id, label: project.name, tags: getProjectTags(state, { projectId: project.id, profileId: profileIdFor(actor) }).map((tag) => tag.label) })) };
      },
      async "knowledge.prompt-fragments.list"({ config }, { actor, storage }) {
        const state = await loadState(storage);
        const projectId = config.projectId;
        const tags = getProjectTags(state, { projectId, profileId: profileIdFor(actor) });
        const labels = new Map(tags.map((tag) => [tag.id, tag.label]));
        const categoryTags = config.categoryTags ?? { world: config.worldTag, style: config.styleTag, composition: config.compositionTag, mood: config.moodTag };
        const items = []; const excluded = [];
        for (const summary of listPages(state, { projectId, profileId: profileIdFor(actor) })) {
          const pageLabels = summary.tagIds.map((tagId) => labels.get(tagId)).filter(Boolean);
          if (!pageLabels.includes(config.publishTag)) { excluded.push({ pageId: summary.id, reason: "公開用Tagがありません" }); continue; }
          const categories = Object.entries(categoryTags).filter(([, tag]) => tag && pageLabels.includes(tag)).map(([category]) => category);
          if (categories.length !== 1) { excluded.push({ pageId: summary.id, reason: categories.length ? "分類Tagが複数あります" : "分類Tagがありません" }); continue; }
          const page = readPage(state, { projectId, pageId: summary.id, profileId: profileIdFor(actor) });
          const prompt = pageMarkdown(page).trim();
          if (!prompt) { excluded.push({ pageId: summary.id, reason: "Prompt本文が空です" }); continue; }
          items.push({ id: `note-${page.id}`, name: page.title, category: categories[0], prompt, source: "note", sourceAppId: "knowledge", sourceId: page.id, revision: page.revision, state: "active" });
        }
        return { items, excluded };
      },
      async "knowledge.generated-image.consume"({ item, config, deliveryId }, { actor, storage, resources }) {
        const delivered = await storage.readJson(CONNECTION_DELIVERIES_KEY) ?? { deliveries: {} };
        if (delivered.deliveries[deliveryId]) return { pageId: delivered.deliveries[deliveryId], duplicate: true };
        if (!config.projectId || !item.resource || !item.generationId) throw new KnowledgeDomainError("INVALID_CONNECTION_INPUT", "出力Projectと生成画像が必要です");
        let state = await loadState(storage);
        const deterministicTitle = `Image · ${(item.finalPrompt || "生成画像").split("\n")[0].replace(/^主題:\s*/, "").slice(0, 80)} · ${item.generationId.slice(-8)}`;
        const existing = listPages(state, { projectId: config.projectId, profileId: profileIdFor(actor) }).find((page) => page.title === deterministicTitle);
        if (existing) { delivered.deliveries[deliveryId] = existing.id; await storage.writeJson(CONNECTION_DELIVERIES_KEY, delivered); return { pageId: existing.id, duplicate: true }; }
        const imported = await resources.import(item.resource, { namespace: "images" });
        let mutation = createPage(state, { projectId: config.projectId, title: deterministicTitle, profileId: profileIdFor(actor), actorId: actor.id });
        state = mutation.state; let page = mutation.page;
        mutation = updatePage(state, { projectId: config.projectId, pageId: page.id, expectedRevision: page.revision, profileId: profileIdFor(actor), actorId: actor.id, mutation: { type: "block-update", blockId: page.blocks[0].id, blockType: "image", text: imported.resourceId } });
        state = mutation.state; page = mutation.page;
        const selectionLabels = { world: "世界観", style: "画風", composition: "用途・構図", mood: "雰囲気・装飾" };
        const selectedTemplates = Object.entries(item.selections ?? {})
          .filter(([, templateId]) => templateId)
          .map(([category, templateId]) => `- ${selectionLabels[category] ?? category}: ${templateId}`);
        const markdown = [
          `## 生成条件`,
          ...selectedTemplates,
          `- 縦横比: ${item.ratio}`,
          `- 実寸: ${item.width}×${item.height}`,
          `- 生成日時: ${item.createdAt}`,
          ``,
          `## 最終Prompt`,
          item.finalPrompt,
        ].join("\n");
        mutation = updatePage(state, { projectId: config.projectId, pageId: page.id, expectedRevision: page.revision, profileId: profileIdFor(actor), actorId: actor.id, mutation: { type: "markdown-set", markdown, mode: "append" } });
        state = mutation.state; page = mutation.page;
        if (config.pageTag) { mutation = updatePage(state, { projectId: config.projectId, pageId: page.id, expectedRevision: page.revision, profileId: profileIdFor(actor), actorId: actor.id, mutation: { type: "tags-set", labels: [config.pageTag] } }); state = mutation.state; page = mutation.page; }
        await storage.writeJson(STATE_KEY, state);
        delivered.deliveries[deliveryId] = page.id; await storage.writeJson(CONNECTION_DELIVERIES_KEY, delivered);
        return { pageId: page.id, duplicate: false };
      },
      async "knowledge.profile.link-account"({ accountId }, { storage }) {
        const mutation = await saveMutation(storage, adoptLocalMemberships(await loadState(storage), { accountId }));
        return { adoptedProjectIds: mutation.adoptedProjectIds };
      },
    },
  });
}
