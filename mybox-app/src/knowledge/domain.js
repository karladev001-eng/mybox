import { LOCAL_PROFILE_ID } from "../core/account-identity.js";

export const KNOWLEDGE_SCHEMA_VERSION = 1;
export const PAGE_STATES = Object.freeze(["active", "trash"]);
export const PROJECT_ROLES = Object.freeze(["viewer", "editor", "owner"]);
export const BLOCK_TYPES = Object.freeze([
  "paragraph",
  "heading-1",
  "heading-2",
  "heading-3",
  "bulleted-list",
  "numbered-list",
  "checklist",
  "quote",
  "code",
  "divider",
  "math",
  "url-embed",
]);

const ROLE_RANK = Object.freeze({ viewer: 1, editor: 2, owner: 3 });
const HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export class KnowledgeDomainError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "KnowledgeDomainError";
    this.code = code;
    this.details = details;
  }
}

function newId(prefix = "id") {
  const value = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`;
}

function isoNow(now) {
  const value = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(value.getTime())) {
    throw new KnowledgeDomainError("INVALID_TIME", "A valid timestamp is required");
  }
  return value.toISOString();
}

function copy(value) {
  return structuredClone(value);
}

function requireText(value, code, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new KnowledgeDomainError(code, `${label} is required`);
  }
  return value.trim();
}

export function normalizePageTitle(title) {
  const displayTitle = requireText(title, "INVALID_PAGE_TITLE", "Page title");
  return displayTitle.normalize("NFKC").toLocaleLowerCase("ja-JP");
}

function normalizeTagLabel(label) {
  return requireText(label, "INVALID_TAG_LABEL", "Tag label")
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP");
}

function findProject(state, projectId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) throw new KnowledgeDomainError("PROJECT_NOT_FOUND", "Project was not found", { projectId });
  return project;
}

function findPage(state, projectId, pageId) {
  const page = state.pages.find((item) => item.id === pageId && item.projectId === projectId);
  if (!page) throw new KnowledgeDomainError("PAGE_NOT_FOUND", "Page was not found", { projectId, pageId });
  return page;
}

function findBlock(page, blockId) {
  const block = page.blocks.find((item) => item.id === blockId);
  if (!block) throw new KnowledgeDomainError("BLOCK_NOT_FOUND", "Block was not found", { pageId: page.id, blockId });
  return block;
}

function assertRole(project, profileId, minimumRole) {
  const membership = project.members.find((item) => item.profileId === profileId);
  if (!membership || ROLE_RANK[membership.role] < ROLE_RANK[minimumRole]) {
    throw new KnowledgeDomainError("PROJECT_ROLE_REQUIRED", `${minimumRole} Project role is required`, {
      projectId: project.id,
      profileId,
      minimumRole,
      actualRole: membership?.role ?? null,
    });
  }
  return membership.role;
}

function assertRevision(page, expectedRevision) {
  if (!Number.isInteger(expectedRevision) || page.revision !== expectedRevision) {
    throw new KnowledgeDomainError("REVISION_CONFLICT", "Page revision has changed", {
      pageId: page.id,
      expectedRevision,
      actualRevision: page.revision,
    });
  }
}

function assertUniqueTitle(state, projectId, title, exceptPageId = null) {
  const normalizedTitle = normalizePageTitle(title);
  const duplicate = state.pages.find((page) => (
    page.projectId === projectId
    && page.id !== exceptPageId
    && page.normalizedTitle === normalizedTitle
  ));
  if (duplicate) {
    throw new KnowledgeDomainError("PAGE_TITLE_CONFLICT", "Page title already exists in this Project", {
      projectId,
      title: title.trim(),
      conflictingPageId: duplicate.id,
      conflictingState: duplicate.state,
    });
  }
  return normalizedTitle;
}

function pageSnapshot(page) {
  return copy({
    title: page.title,
    normalizedTitle: page.normalizedTitle,
    blocks: page.blocks,
    tagIds: page.tagIds,
  });
}

function trimHistory(state, now) {
  const cutoff = new Date(now).getTime() - HISTORY_RETENTION_MS;
  state.history = state.history.filter((entry) => new Date(entry.createdAt).getTime() >= cutoff);
}

function recordHistory(state, page, { actorId, now, idFactory }) {
  const createdAt = isoNow(now);
  trimHistory(state, createdAt);
  state.history.push({
    id: idFactory("history"),
    projectId: page.projectId,
    pageId: page.id,
    pageRevision: page.revision,
    actorId,
    createdAt,
    snapshot: pageSnapshot(page),
  });
}

function touchPage(page, now) {
  page.revision += 1;
  page.updatedAt = isoNow(now);
}

function replaceAll(value, search, replacement) {
  return value.split(search).join(replacement);
}

function convertLinksToText(state, targetPage, context) {
  const recorded = new Set(context.recordedPageIds ?? []);
  for (const sourcePage of state.pages) {
    let pageChanged = false;
    for (const block of sourcePage.blocks) {
      const incoming = block.links.filter((link) => link.targetPageId === targetPage.id);
      if (!incoming.length) continue;
      if (!recorded.has(sourcePage.id)) {
        recordHistory(state, sourcePage, context);
        recorded.add(sourcePage.id);
      }
      for (const link of incoming) {
        block.text = replaceAll(block.text, link.token, targetPage.title);
      }
      block.links = block.links.filter((link) => link.targetPageId !== targetPage.id);
      block.revision += 1;
      pageChanged = true;
    }
    if (pageChanged && sourcePage.id !== context.deferTouchPageId) touchPage(sourcePage, context.now);
  }
  return recorded;
}

function resolveTagIds(state, projectId, labels, context) {
  const uniqueLabels = [...new Map(labels.map((label) => {
    const displayLabel = requireText(label, "INVALID_TAG_LABEL", "Tag label");
    return [normalizeTagLabel(displayLabel), displayLabel];
  })).entries()];
  return uniqueLabels.map(([normalizedLabel, displayLabel]) => {
    let tag = state.tags.find((item) => item.projectId === projectId && item.normalizedLabel === normalizedLabel);
    if (!tag) {
      tag = {
        id: context.idFactory("tag"),
        projectId,
        label: displayLabel,
        normalizedLabel,
        createdAt: isoNow(context.now),
      };
      state.tags.push(tag);
    }
    return tag.id;
  });
}

export function createKnowledgeState({
  profileId = LOCAL_PROFILE_ID,
  now = new Date(),
  idFactory = newId,
} = {}) {
  const timestamp = isoNow(now);
  const personalProject = {
    id: idFactory("project"),
    name: "Personal",
    createdAt: timestamp,
    updatedAt: timestamp,
    members: [{ profileId, role: "owner" }],
  };
  return {
    schemaVersion: KNOWLEDGE_SCHEMA_VERSION,
    projects: [personalProject],
    pages: [],
    tags: [],
    history: [],
  };
}

export function validateKnowledgeState(state) {
  if (!state || state.schemaVersion !== KNOWLEDGE_SCHEMA_VERSION) {
    throw new KnowledgeDomainError("INVALID_KNOWLEDGE_STATE", "Knowledge state schema is unsupported");
  }
  for (const key of ["projects", "pages", "tags", "history"]) {
    if (!Array.isArray(state[key])) {
      throw new KnowledgeDomainError("INVALID_KNOWLEDGE_STATE", `Knowledge state requires ${key}`);
    }
  }
  return state;
}

export function listProjects(state, { profileId = LOCAL_PROFILE_ID } = {}) {
  validateKnowledgeState(state);
  return state.projects
    .filter((project) => project.members.some((member) => member.profileId === profileId))
    .map((project) => {
      const role = project.members.find((member) => member.profileId === profileId).role;
      return {
        id: project.id,
        name: project.name,
        role,
        activePageCount: state.pages.filter((page) => page.projectId === project.id && page.state === "active").length,
        trashPageCount: state.pages.filter((page) => page.projectId === project.id && page.state === "trash").length,
      };
    });
}

export function createProject(state, {
  name,
  profileId = LOCAL_PROFILE_ID,
  now = new Date(),
  idFactory = newId,
} = {}) {
  const next = copy(validateKnowledgeState(state));
  const displayName = requireText(name, "INVALID_PROJECT_NAME", "Project name");
  const project = {
    id: idFactory("project"),
    name: displayName,
    createdAt: isoNow(now),
    updatedAt: isoNow(now),
    members: [{ profileId, role: "owner" }],
  };
  next.projects.push(project);
  return { state: next, project: copy(project) };
}

export function renameProject(state, {
  projectId,
  name,
  profileId = LOCAL_PROFILE_ID,
  now = new Date(),
} = {}) {
  const next = copy(validateKnowledgeState(state));
  const project = findProject(next, projectId);
  assertRole(project, profileId, "owner");
  project.name = requireText(name, "INVALID_PROJECT_NAME", "Project name");
  project.updatedAt = isoNow(now);
  return { state: next, project: copy(project) };
}

export function deleteProject(state, {
  projectId,
  profileId = LOCAL_PROFILE_ID,
} = {}) {
  const next = copy(validateKnowledgeState(state));
  const project = findProject(next, projectId);
  assertRole(project, profileId, "owner");
  next.projects = next.projects.filter((item) => item.id !== projectId);
  next.pages = next.pages.filter((page) => page.projectId !== projectId);
  next.tags = next.tags.filter((tag) => tag.projectId !== projectId);
  next.history = next.history.filter((entry) => entry.projectId !== projectId);
  return { state: next, projectId };
}

export function listPages(state, {
  projectId,
  profileId = LOCAL_PROFILE_ID,
  includeTrash = false,
} = {}) {
  validateKnowledgeState(state);
  const project = findProject(state, projectId);
  assertRole(project, profileId, "viewer");
  const allowedStates = includeTrash ? PAGE_STATES : ["active"];
  return state.pages
    .filter((page) => page.projectId === projectId && allowedStates.includes(page.state))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((page) => ({
      id: page.id,
      projectId: page.projectId,
      title: page.title,
      state: page.state,
      revision: page.revision,
      updatedAt: page.updatedAt,
      tagIds: [...page.tagIds],
      excerpt: page.blocks.find((block) => block.text.trim())?.text.slice(0, 120) ?? "",
    }));
}

export function createPage(state, {
  projectId,
  title,
  profileId = LOCAL_PROFILE_ID,
  actorId = profileId,
  now = new Date(),
  idFactory = newId,
} = {}) {
  const next = copy(validateKnowledgeState(state));
  const project = findProject(next, projectId);
  assertRole(project, profileId, "editor");
  const displayTitle = requireText(title, "INVALID_PAGE_TITLE", "Page title");
  const normalizedTitle = assertUniqueTitle(next, projectId, displayTitle);
  const timestamp = isoNow(now);
  const page = {
    id: idFactory("page"),
    projectId,
    title: displayTitle,
    normalizedTitle,
    state: "active",
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    blocks: [{
      id: idFactory("block"),
      type: "paragraph",
      text: "",
      checked: false,
      revision: 1,
      links: [],
    }],
    tagIds: [],
  };
  next.pages.push(page);
  project.updatedAt = timestamp;
  return { state: next, page: copy(page), actorId };
}

export function readPage(state, {
  projectId,
  pageId,
  profileId = LOCAL_PROFILE_ID,
} = {}) {
  validateKnowledgeState(state);
  const project = findProject(state, projectId);
  assertRole(project, profileId, "viewer");
  return copy(findPage(state, projectId, pageId));
}

export function updatePage(state, {
  projectId,
  pageId,
  expectedRevision,
  mutation,
  profileId = LOCAL_PROFILE_ID,
  actorId = profileId,
  now = new Date(),
  idFactory = newId,
} = {}) {
  const next = copy(validateKnowledgeState(state));
  const project = findProject(next, projectId);
  assertRole(project, profileId, "editor");
  const page = findPage(next, projectId, pageId);
  if (page.state !== "active") throw new KnowledgeDomainError("PAGE_IN_TRASH", "Restore the Page before editing", { pageId });
  assertRevision(page, expectedRevision);
  if (!mutation || typeof mutation.type !== "string") {
    throw new KnowledgeDomainError("INVALID_PAGE_MUTATION", "Page mutation type is required");
  }
  const context = { actorId, now, idFactory };
  recordHistory(next, page, context);

  switch (mutation.type) {
    case "rename": {
      const title = requireText(mutation.title, "INVALID_PAGE_TITLE", "Page title");
      const normalizedTitle = assertUniqueTitle(next, projectId, title, page.id);
      const previousTitle = page.title;
      page.title = title;
      page.normalizedTitle = normalizedTitle;
      for (const sourcePage of next.pages) {
        const hasIncomingLink = sourcePage.blocks.some((block) => (
          block.links.some((link) => link.targetPageId === page.id)
        ));
        if (hasIncomingLink && sourcePage.id !== page.id) recordHistory(next, sourcePage, context);
        let sourceChanged = false;
        for (const block of sourcePage.blocks) {
          for (const link of block.links) {
            if (link.targetPageId !== page.id) continue;
            const nextToken = `[[${title}]]`;
            block.text = replaceAll(block.text, link.token, nextToken);
            link.token = nextToken;
            block.revision += 1;
            sourceChanged = true;
          }
        }
        if (sourceChanged && sourcePage.id !== page.id) touchPage(sourcePage, now);
      }
      if (!previousTitle) throw new KnowledgeDomainError("INVALID_PAGE_TITLE", "Page title is required");
      break;
    }
    case "block-update": {
      const block = findBlock(page, mutation.blockId);
      if (mutation.blockType !== undefined) {
        if (!BLOCK_TYPES.includes(mutation.blockType)) {
          throw new KnowledgeDomainError("INVALID_BLOCK_TYPE", "Block type is invalid", { blockType: mutation.blockType });
        }
        block.type = mutation.blockType;
      }
      if (mutation.text !== undefined) {
        if (typeof mutation.text !== "string") throw new KnowledgeDomainError("INVALID_BLOCK_TEXT", "Block text must be a string");
        block.text = mutation.text;
        block.links = block.links.filter((link) => block.text.includes(link.token));
      }
      if (mutation.checked !== undefined) block.checked = mutation.checked === true;
      block.revision += 1;
      break;
    }
    case "block-add": {
      const block = {
        id: idFactory("block"),
        type: BLOCK_TYPES.includes(mutation.blockType) ? mutation.blockType : "paragraph",
        text: typeof mutation.text === "string" ? mutation.text : "",
        checked: false,
        revision: 1,
        links: [],
      };
      const afterIndex = mutation.afterBlockId
        ? page.blocks.findIndex((item) => item.id === mutation.afterBlockId)
        : page.blocks.length - 1;
      page.blocks.splice(afterIndex < 0 ? page.blocks.length : afterIndex + 1, 0, block);
      break;
    }
    case "block-remove": {
      const index = page.blocks.findIndex((item) => item.id === mutation.blockId);
      if (index < 0) throw new KnowledgeDomainError("BLOCK_NOT_FOUND", "Block was not found", { blockId: mutation.blockId });
      if (page.blocks.length === 1) {
        page.blocks[0] = { ...page.blocks[0], type: "paragraph", text: "", checked: false, links: [], revision: page.blocks[0].revision + 1 };
      } else {
        page.blocks.splice(index, 1);
      }
      break;
    }
    case "block-move": {
      const index = page.blocks.findIndex((item) => item.id === mutation.blockId);
      if (index < 0) throw new KnowledgeDomainError("BLOCK_NOT_FOUND", "Block was not found", { blockId: mutation.blockId });
      if (mutation.beforeBlockId !== undefined) {
        const [block] = page.blocks.splice(index, 1);
        if (mutation.beforeBlockId === null) {
          page.blocks.push(block);
        } else {
          const targetIndex = page.blocks.findIndex((item) => item.id === mutation.beforeBlockId);
          if (targetIndex < 0) {
            page.blocks.splice(index, 0, block);
            throw new KnowledgeDomainError("BLOCK_NOT_FOUND", "Block was not found", { blockId: mutation.beforeBlockId });
          }
          page.blocks.splice(targetIndex, 0, block);
        }
      } else {
        const offset = mutation.direction === "up" ? -1 : mutation.direction === "down" ? 1 : 0;
        const target = index + offset;
        if (offset && target >= 0 && target < page.blocks.length) {
          const [block] = page.blocks.splice(index, 1);
          page.blocks.splice(target, 0, block);
        }
      }
      break;
    }
    case "link-add": {
      const block = findBlock(page, mutation.blockId);
      let target;
      if (mutation.targetPageId) {
        target = findPage(next, projectId, mutation.targetPageId);
      } else {
        const title = requireText(mutation.createTitle, "INVALID_PAGE_TITLE", "Page title");
        const normalizedTitle = assertUniqueTitle(next, projectId, title);
        const timestamp = isoNow(now);
        target = {
          id: idFactory("page"),
          projectId,
          title,
          normalizedTitle,
          state: "active",
          revision: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
          blocks: [{
            id: idFactory("block"),
            type: "paragraph",
            text: "",
            checked: false,
            revision: 1,
            links: [],
          }],
          tagIds: [],
        };
        next.pages.push(target);
      }
      if (target.state === "trash") {
        recordHistory(next, target, context);
        target.state = "active";
        touchPage(target, now);
      }
      const sourceText = typeof mutation.text === "string" ? mutation.text : block.text;
      const markerStart = Number.isInteger(mutation.markerStart) ? mutation.markerStart : sourceText.lastIndexOf("[[");
      const markerEnd = Number.isInteger(mutation.markerEnd) ? mutation.markerEnd : sourceText.length;
      if (markerStart < 0 || sourceText.slice(markerStart, markerStart + 2) !== "[[") {
        throw new KnowledgeDomainError("PAGE_LINK_MARKER_REQUIRED", "PageLink creation requires an active [[ marker");
      }
      const token = `[[${target.title}]]`;
      block.text = `${sourceText.slice(0, markerStart)}${token}${sourceText.slice(markerEnd)}`;
      block.links = block.links.filter((link) => block.text.includes(link.token));
      block.links.push({ targetPageId: target.id, token });
      block.revision += 1;
      break;
    }
    case "tags-set": {
      const labels = Array.isArray(mutation.labels) ? mutation.labels : [];
      page.tagIds = resolveTagIds(next, projectId, labels, context);
      break;
    }
    default:
      throw new KnowledgeDomainError("INVALID_PAGE_MUTATION", "Page mutation type is invalid", { type: mutation.type });
  }

  touchPage(page, now);
  project.updatedAt = page.updatedAt;
  return { state: next, page: copy(page) };
}

export function movePageToTrash(state, {
  projectId,
  pageId,
  expectedRevision,
  profileId = LOCAL_PROFILE_ID,
  actorId = profileId,
  now = new Date(),
  idFactory = newId,
} = {}) {
  const next = copy(validateKnowledgeState(state));
  const project = findProject(next, projectId);
  assertRole(project, profileId, "editor");
  const page = findPage(next, projectId, pageId);
  assertRevision(page, expectedRevision);
  if (page.state === "trash") return { state: next, page: copy(page) };
  const context = { actorId, now, idFactory };
  recordHistory(next, page, context);
  convertLinksToText(next, page, { ...context, recordedPageIds: [page.id], deferTouchPageId: page.id });
  page.state = "trash";
  touchPage(page, now);
  return { state: next, page: copy(page) };
}

export function restorePage(state, {
  projectId,
  pageId,
  expectedRevision,
  profileId = LOCAL_PROFILE_ID,
  actorId = profileId,
  now = new Date(),
  idFactory = newId,
} = {}) {
  const next = copy(validateKnowledgeState(state));
  const project = findProject(next, projectId);
  assertRole(project, profileId, "editor");
  const page = findPage(next, projectId, pageId);
  assertRevision(page, expectedRevision);
  if (page.state === "active") return { state: next, page: copy(page) };
  recordHistory(next, page, { actorId, now, idFactory });
  page.state = "active";
  touchPage(page, now);
  return { state: next, page: copy(page) };
}

export function purgePage(state, {
  projectId,
  pageId,
  expectedRevision,
  profileId = LOCAL_PROFILE_ID,
  actorId = profileId,
  now = new Date(),
  idFactory = newId,
} = {}) {
  const next = copy(validateKnowledgeState(state));
  const project = findProject(next, projectId);
  assertRole(project, profileId, "owner");
  const page = findPage(next, projectId, pageId);
  assertRevision(page, expectedRevision);
  convertLinksToText(next, page, { actorId, now, idFactory, deferTouchPageId: page.id });
  next.pages = next.pages.filter((item) => item.id !== page.id);
  next.history = next.history.filter((entry) => entry.pageId !== page.id);
  return { state: next, pageId: page.id, releasedTitle: page.title };
}

export function readPageHistory(state, {
  projectId,
  pageId,
  profileId = LOCAL_PROFILE_ID,
  now = new Date(),
} = {}) {
  validateKnowledgeState(state);
  const project = findProject(state, projectId);
  assertRole(project, profileId, "viewer");
  findPage(state, projectId, pageId);
  const cutoff = new Date(now).getTime() - HISTORY_RETENTION_MS;
  return state.history
    .filter((entry) => entry.projectId === projectId && entry.pageId === pageId && new Date(entry.createdAt).getTime() >= cutoff)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((entry) => copy(entry));
}

export function restorePageHistory(state, {
  projectId,
  pageId,
  historyId,
  expectedRevision,
  profileId = LOCAL_PROFILE_ID,
  actorId = profileId,
  now = new Date(),
  idFactory = newId,
} = {}) {
  const next = copy(validateKnowledgeState(state));
  const project = findProject(next, projectId);
  assertRole(project, profileId, "editor");
  const page = findPage(next, projectId, pageId);
  assertRevision(page, expectedRevision);
  const entry = next.history.find((item) => item.id === historyId && item.pageId === pageId);
  if (!entry) throw new KnowledgeDomainError("HISTORY_NOT_FOUND", "Page history entry was not found", { historyId });
  assertUniqueTitle(next, projectId, entry.snapshot.title, page.id);
  recordHistory(next, page, { actorId, now, idFactory });
  page.title = entry.snapshot.title;
  page.normalizedTitle = entry.snapshot.normalizedTitle;
  page.blocks = copy(entry.snapshot.blocks);
  page.tagIds = [...entry.snapshot.tagIds];
  touchPage(page, now);
  return { state: next, page: copy(page) };
}

export function getBacklinks(state, {
  projectId,
  pageId,
  profileId = LOCAL_PROFILE_ID,
} = {}) {
  validateKnowledgeState(state);
  const project = findProject(state, projectId);
  assertRole(project, profileId, "viewer");
  findPage(state, projectId, pageId);
  return state.pages.flatMap((page) => page.blocks.flatMap((block) => (
    block.links
      .filter((link) => link.targetPageId === pageId)
      .map(() => ({
        projectId,
        pageId: page.id,
        pageTitle: page.title,
        pageState: page.state,
        blockId: block.id,
        excerpt: block.text.slice(0, 180),
        revision: page.revision,
      }))
  )));
}

export function searchPages(state, {
  query = "",
  projectIds,
  profileId = LOCAL_PROFILE_ID,
  includeTrash = false,
} = {}) {
  validateKnowledgeState(state);
  const allowedProjectIds = (Array.isArray(projectIds) && projectIds.length ? projectIds : state.projects.map((project) => project.id))
    .filter((projectId) => {
      const project = findProject(state, projectId);
      try {
        assertRole(project, profileId, "viewer");
        return true;
      } catch {
        return false;
      }
    });
  const needle = query.trim().normalize("NFKC").toLocaleLowerCase("ja-JP");
  const allowedStates = includeTrash ? PAGE_STATES : ["active"];
  const results = [];
  for (const page of state.pages) {
    if (!allowedProjectIds.includes(page.projectId) || !allowedStates.includes(page.state)) continue;
    const tagLabels = page.tagIds
      .map((tagId) => state.tags.find((tag) => tag.id === tagId)?.label)
      .filter(Boolean);
    const titleMatch = !needle || page.normalizedTitle.includes(needle) || tagLabels.some((label) => normalizeTagLabel(label).includes(needle));
    if (titleMatch) {
      results.push({
        projectId: page.projectId,
        pageId: page.id,
        pageTitle: page.title,
        pageState: page.state,
        pageRevision: page.revision,
        blockId: page.blocks[0]?.id ?? null,
        blockRevision: page.blocks[0]?.revision ?? null,
        excerpt: page.blocks.find((block) => block.text.trim())?.text.slice(0, 180) ?? "",
        reason: needle ? "title-or-tag" : "recent",
      });
    }
    if (!needle) continue;
    for (const block of page.blocks) {
      const normalizedText = block.text.normalize("NFKC").toLocaleLowerCase("ja-JP");
      const index = normalizedText.indexOf(needle);
      if (index < 0) continue;
      results.push({
        projectId: page.projectId,
        pageId: page.id,
        pageTitle: page.title,
        pageState: page.state,
        pageRevision: page.revision,
        blockId: block.id,
        blockRevision: block.revision,
        excerpt: block.text.slice(Math.max(0, index - 48), index + needle.length + 96),
        reason: "block-text",
      });
    }
  }
  return results
    .sort((a, b) => {
      const aPage = state.pages.find((page) => page.id === a.pageId);
      const bPage = state.pages.find((page) => page.id === b.pageId);
      return bPage.updatedAt.localeCompare(aPage.updatedAt);
    })
    .slice(0, 100);
}

/**
 * Grants a newly linked account the role the local profile already holds in
 * each local Project. Without it a User signs in and loses access to Pages they
 * created while signed out. The local profile keeps its membership so signing
 * out restores the previous state, and repeated calls change nothing.
 */
export function adoptLocalMemberships(state, {
  accountId,
  now = new Date(),
} = {}) {
  const next = copy(validateKnowledgeState(state));
  const profileId = requireText(accountId, "INVALID_ACCOUNT_ID", "Account ID");
  if (profileId === LOCAL_PROFILE_ID) {
    throw new KnowledgeDomainError("INVALID_ACCOUNT_ID", "Account ID must differ from the local profile", { accountId });
  }
  const adoptedProjectIds = [];
  for (const project of next.projects) {
    const local = project.members.find((member) => member.profileId === LOCAL_PROFILE_ID);
    if (!local || project.members.some((member) => member.profileId === profileId)) continue;
    project.members.push({ profileId, role: local.role });
    project.updatedAt = isoNow(now);
    adoptedProjectIds.push(project.id);
  }
  return { state: next, adoptedProjectIds };
}

export function getProjectTags(state, { projectId, profileId = LOCAL_PROFILE_ID } = {}) {
  validateKnowledgeState(state);
  const project = findProject(state, projectId);
  assertRole(project, profileId, "viewer");
  return state.tags
    .filter((tag) => tag.projectId === projectId)
    .map((tag) => ({
      ...copy(tag),
      pageCount: state.pages.filter((page) => page.projectId === projectId && page.tagIds.includes(tag.id)).length,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "ja"));
}
