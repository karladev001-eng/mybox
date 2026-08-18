import { LOCAL_PROFILE_ID } from "../core/account-identity.js";
import { APP_SCHEMA_VERSION, defineApp } from "../core/app-contract.js";
import {
  adoptLocalMemberships,
  createKnowledgeState,
  createPage,
  createProject,
  deleteProject,
  getBacklinks,
  getProjectTags,
  listPages,
  listProjects,
  movePageToTrash,
  purgePage,
  readPage,
  readPageHistory,
  renameProject,
  restorePage,
  restorePageHistory,
  searchPages,
  updatePage,
  validateKnowledgeState,
} from "./domain.js";

const STATE_KEY = "state.json";
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
    expectedRevision: { type: "integer", minimum: 1 },
  },
};

export function createKnowledgeApp() {
  return defineApp({
    manifest: {
      schemaVersion: APP_SCHEMA_VERSION,
      id: "knowledge",
      name: "Note",
      version: "0.1.0",
      hostCapabilities: ["app-storage"],
      operations: [
        operation({ id: "knowledge.project.list", title: "Projectを一覧", effect: "read", confirmationClass: "review", inputSchema: objectSchema }),
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
            properties: { ...revisionInput.properties, mutation: { type: "object" } },
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
    },
    handlers: {
      async "knowledge.project.list"(_input, { actor, storage }) {
        const state = await loadState(storage);
        return { projects: listProjects(state, { profileId: profileIdFor(actor) }) };
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
        const state = await loadState(storage);
        return { pages: listPages(state, { projectId, includeTrash, profileId: profileIdFor(actor) }) };
      },
      async "knowledge.page.read"({ projectId, pageId }, { actor, storage }) {
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
      async "knowledge.profile.link-account"({ accountId }, { storage }) {
        const mutation = await saveMutation(storage, adoptLocalMemberships(await loadState(storage), { accountId }));
        return { adoptedProjectIds: mutation.adoptedProjectIds };
      },
    },
  });
}
