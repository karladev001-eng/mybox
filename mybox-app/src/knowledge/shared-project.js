import { commitRecordPage } from "./yjs-document.js";
import { createSyncClient, encodeDocState } from "./sync-client.js";
import { isAuthorColor } from "./author-color.js";
import { normalizePageTitle, normalizeTagLabel } from "./domain.js";
import {
  applyPageMutation,
  createProjectDoc,
  deletePage,
  listMemberColors as listDocumentMemberColors,
  listMemberProfiles as listDocumentMemberProfiles,
  listPageIds,
  listTags as listDocumentTags,
  readPage,
  setMemberColor as setDocumentMemberColor,
  setMemberProfile as setDocumentMemberProfile,
  seedPage,
  seedTags,
} from "./yjs-document.js";

/** Encodes local JSON Pages and Tags into the Yjs state used by a Project store. */
export function encodeProjectPages(pages, tags = []) {
  const doc = createProjectDoc();
  seedTags(doc, tags);
  for (const page of pages) seedPage(doc, page);
  return encodeDocState(doc);
}

/** Mutations the shared document can apply today. */
const SHARED_MUTATIONS = new Set(["rename", "page-state", "block-update", "block-add", "block-paste", "block-remove", "blocks-remove", "blocks-restore", "block-move", "link-add", "tags-set"]);

export class SharedProjectError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SharedProjectError";
    this.code = code;
    this.details = details;
  }
}

function newBlockId() {
  return `block-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function newPageId() {
  return `page-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function newTagId(normalizedLabel) {
  // A stable key makes two offline peers creating the same normalized label
  // converge on one Tag when their Yjs updates merge.
  return `tag-${encodeURIComponent(normalizedLabel)}`;
}

function projectTags(doc, projectId, pages = listPageIds(doc).map((id) => readPage(doc, id)).filter(Boolean)) {
  const counts = new Map();
  for (const page of pages) {
    for (const id of new Set(page.tagIds)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return listDocumentTags(doc)
    .map((tag) => ({
      ...tag,
      projectId,
      pageCount: counts.get(tag.id) ?? 0,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, "ja"));
}

function createPageRecord(doc, projectId, title, actorId) {
  const displayTitle = typeof title === "string" ? title.trim() : "";
  const normalizedTitle = normalizePageTitle(displayTitle);
  const conflict = listPageIds(doc)
    .map((id) => readPage(doc, id))
    .find((page) => normalizePageTitle(page.title) === normalizedTitle);
  if (conflict) {
    throw new SharedProjectError(
      "PAGE_TITLE_CONFLICT",
      "A Page with this title already exists in the Project or Trash",
      { title: displayTitle, conflictingState: conflict.state },
    );
  }
  const timestamp = new Date().toISOString();
  return {
    id: newPageId(),
    projectId,
    title: displayTitle,
    state: "active",
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: actorId,
    updatedBy: actorId,
    tagIds: [],
    blocks: [{
      id: newBlockId(),
      type: "paragraph",
      text: "",
      checked: false,
      updatedBy: actorId,
      links: [],
    }],
  };
}

/**
 * Resolves the editor's unfinished `[[` marker against a Page. When the Page
 * does not exist yet, its creation and the source Block update are committed as
 * one Yjs transaction so peers can never observe only half of the PageLink.
 */
function addPageLink(doc, projectId, pageId, mutation, actorId) {
  const source = readPage(doc, pageId);
  if (!source) throw new SharedProjectError("PAGE_NOT_FOUND", "Page was not found", { projectId, pageId });
  const block = source.blocks.find((item) => item.id === mutation.blockId);
  if (!block) throw new SharedProjectError("BLOCK_NOT_FOUND", "Block was not found", { pageId, blockId: mutation.blockId });

  let target = mutation.targetPageId ? readPage(doc, mutation.targetPageId) : null;
  let created = null;
  if (mutation.targetPageId && !target) {
    throw new SharedProjectError("PAGE_NOT_FOUND", "Page was not found", { projectId, pageId: mutation.targetPageId });
  }
  if (!target) {
    created = createPageRecord(doc, projectId, mutation.createTitle, actorId);
    target = created;
  }

  const sourceText = typeof mutation.text === "string" ? mutation.text : block.text;
  const markerStart = Number.isInteger(mutation.markerStart) ? mutation.markerStart : sourceText.lastIndexOf("[[");
  const markerEnd = Number.isInteger(mutation.markerEnd) ? mutation.markerEnd : sourceText.length;
  if (markerStart < 0 || sourceText.slice(markerStart, markerStart + 2) !== "[[") {
    throw new SharedProjectError("PAGE_LINK_MARKER_REQUIRED", "PageLink creation requires an active [[ marker");
  }
  const token = `[[${target.title}]]`;
  const text = `${sourceText.slice(0, markerStart)}${token}${sourceText.slice(markerEnd)}`;

  doc.transact(() => {
    if (created) seedPage(doc, created);
    if (!created && target.state === "trash") {
      applyPageMutation(doc, target.id, { type: "page-state", state: "active" }, { actorId });
    }
    applyPageMutation(doc, pageId, {
      type: "link-add",
      blockId: mutation.blockId,
      targetPageId: target.id,
      token,
      text,
    }, { actorId });
  });
  return readPage(doc, pageId);
}

/** Resolves Tag labels to shared definitions and replaces a Page's Tag set. */
function setPageTags(doc, projectId, pageId, mutation, actorId) {
  if (!readPage(doc, pageId)) {
    throw new SharedProjectError("PAGE_NOT_FOUND", "Page was not found", { projectId, pageId });
  }
  const labels = Array.isArray(mutation.labels) ? mutation.labels : [];
  const uniqueLabels = [...new Map(labels.map((label) => {
    const displayLabel = typeof label === "string" ? label.trim() : label;
    return [normalizeTagLabel(displayLabel), displayLabel];
  })).entries()];
  const existing = new Map(listDocumentTags(doc).map((tag) => [tag.normalizedLabel, tag]));
  const created = [];
  const tagIds = uniqueLabels.map(([normalizedLabel, label]) => {
    const tag = existing.get(normalizedLabel);
    if (tag) return tag.id;
    const next = { id: newTagId(normalizedLabel), label, normalizedLabel };
    existing.set(normalizedLabel, next);
    created.push(next);
    return next.id;
  });

  doc.transact(() => {
    if (created.length) seedTags(doc, created);
    applyPageMutation(doc, pageId, { type: "tags-set", tagIds }, { actorId });
  });
  return readPage(doc, pageId);
}

/** The document wants a whole Block where the domain names a type and text. */
function toDocumentMutation(mutation) {
  if (mutation.type !== "block-add") return mutation;
  return {
    type: "block-add",
    afterBlockId: mutation.afterBlockId,
    block: {
      id: newBlockId(),
      type: mutation.blockType ?? "paragraph",
      text: mutation.text ?? "",
      checked: false,
      links: [],
    },
  };
}

/**
 * A shared Project's live state: one Yjs document plus the client keeping it in
 * step with the group's server.
 *
 * The view asks this for Pages instead of the JSON store, but gets the same
 * shapes back, so the editor does not branch on whether a Project is shared.
 * Mutations carry no expected revision here: a CRDT converges rather than
 * rejecting, which is what allows two people to type at once.
 */
export function createSharedProject({
  endpoint,
  projectId,
  token,
  onChange = () => {},
  onStatus = () => {},
  onError = () => {},
  onPresence = () => {},
  createClient = createSyncClient,
}) {
  const doc = createProjectDoc();
  let status = "idle";
  let disposed = false;
  let handlers = { onChange, onStatus, onError, onPresence };

  // Fires for local and remote updates alike, so the editor re-reads whenever
  // the document moves for any reason.
  const notify = () => handlers.onChange();
  doc.on("update", notify);

  const client = createClient({
    doc,
    endpoint,
    projectId,
    token,
    onStatus: (state) => {
      status = state.status;
      handlers.onStatus(state);
    },
    onError: (error) => handlers.onError(error),
    onAwareness: (presence) => handlers.onPresence(presence),
  });

  return {
    doc,
    get status() { return status; },
    get role() { return client.role; },
    flush: () => client.flush?.() ?? Promise.resolve(),
    commitRecord(page) {
      if (!["owner", "editor"].includes(client.role)) throw new SharedProjectError("PROJECT_ROLE_REQUIRED", "Editor Project role is required");
      commitRecordPage(doc, page);
    },
    get disposed() { return disposed; },

    /**
     * The runtime keeps this session alive while App surfaces change. The Note
     * surface attaches its React handlers when visible and detaches them when
     * hidden, without taking the shared document away from Image or Agents.
     */
    setHandlers(next = {}) {
      handlers = {
        onChange: next.onChange ?? (() => {}),
        onStatus: next.onStatus ?? (() => {}),
        onError: next.onError ?? (() => {}),
        onPresence: next.onPresence ?? (() => {}),
      };
    },

    connect() {
      return client.connect();
    },

    listPages(includeTrash = false) {
      const labelsById = new Map(listDocumentTags(doc).map((tag) => [tag.id, tag.label]));
      return listPageIds(doc)
        .map((id) => readPage(doc, id))
        .filter((page) => page && (includeTrash || page.state === "active"))
        .map((page) => ({
          id: page.id,
          projectId,
          title: page.title,
          kind: page.kind ?? "note",
      folderId: page.folderId ?? null,
          updatedAt: page.updatedAt ?? "",
          state: page.state,
          tagIds: page.tagIds,
          tagLabels: page.tagIds.map((tagId) => labelsById.get(tagId)).filter(Boolean),
          excerpt: page.blocks.find((block) => block.text.trim())?.text.slice(0, 120) ?? "",
        }));
    },

    /** Raw Project records for authorized aggregate Operations; no per-Page backlinks. */
    readRecords() {
      const pages = listPageIds(doc).map((id) => readPage(doc, id)).filter(Boolean)
        .map((page) => ({ ...page, projectId, revision: 0 }));
      return { pages, tags: projectTags(doc, projectId, pages) };
    },

    readPage(pageId) {
      const page = readPage(doc, pageId);
      if (!page) return null;
      // Backlinks are derived rather than stored, so they stay correct after a
      // merge without any peer having to recompute them.
      const backlinks = listPageIds(doc).flatMap((sourceId) => {
        const source = readPage(doc, sourceId);
        return source.blocks
          .filter((block) => block.links.some((link) => link.targetPageId === pageId))
          .map((block) => ({
            projectId,
            pageId: sourceId,
            pageTitle: source.title,
            pageState: source.state,
            blockId: block.id,
            excerpt: block.text.slice(0, 180),
          }));
      });
      const tags = projectTags(doc, projectId).filter((tag) => page.tagIds.includes(tag.id));
      return { page: { ...page, projectId, revision: 0 }, tags, backlinks };
    },

    /**
     * Takes the same mutation vocabulary `domain.js` does, so every caller —
     * the editor, the assistant, a future Flow — speaks one language and the
     * document is not a second, parallel write path with its own shapes.
     */
    mutate(pageId, mutation, actorId) {
      if (client.role === "viewer") throw new SharedProjectError("PROJECT_ROLE_REQUIRED", "Editor Project role is required");
      const record = readPage(doc, pageId);
      if (record?.kind && record.kind !== "note" && !["rename", "tags-set", "page-state"].includes(mutation.type)) throw new SharedProjectError("IMMUTABLE_RECORD", "会話とContextの本文は変更できません。");
      if (!SHARED_MUTATIONS.has(mutation.type)) {
        throw new SharedProjectError(
          "MUTATION_UNSUPPORTED_WHEN_SHARED",
          "この操作は共有Projectではまだ利用できません。",
          { type: mutation.type },
        );
      }
      if (mutation.type === "link-add") {
        return addPageLink(doc, projectId, pageId, mutation, actorId);
      }
      if (mutation.type === "tags-set") {
        return setPageTags(doc, projectId, pageId, mutation, actorId);
      }
      return applyPageMutation(doc, pageId, toDocumentMutation(mutation), { actorId });
    },

    listTags() {
      return projectTags(doc, projectId);
    },

    listMemberColors() {
      return listDocumentMemberColors(doc);
    },

    setMemberColor(profileId, color, actorId) {
      if (profileId !== actorId && client.role !== "owner") {
        throw new SharedProjectError("PROJECT_ROLE_REQUIRED", "Owner Project role is required");
      }
      if (!isAuthorColor(color)) throw new SharedProjectError("INVALID_AUTHOR_COLOR", "Author color is invalid");
      setDocumentMemberColor(doc, profileId, color);
      return { profileId, color };
    },

    listMemberProfiles() {
      return listDocumentMemberProfiles(doc);
    },

    setMemberProfile(profile, actorId) {
      if (profile?.profileId !== actorId) {
        throw new SharedProjectError("INVALID_MEMBER_PROFILE", "A profile can publish only its own presentation");
      }
      return setDocumentMemberProfile(doc, profile);
    },

    createPage(title, actorId) {
      const page = createPageRecord(doc, projectId, title, actorId);
      seedPage(doc, page);
      return { ...page, ...readPage(doc, page.id) };
    },

    purgePage(pageId) {
      if (client.role !== "owner") {
        throw new SharedProjectError("PROJECT_ROLE_REQUIRED", "Owner Project role is required");
      }
      const page = deletePage(doc, pageId);
      return { pageId, releasedTitle: page.title };
    },

    /** Copies Pages and Tag definitions already held locally into the shared document. */
    adopt(pages, tags = []) {
      const existing = new Set(listPageIds(doc));
      const existingTagIds = new Set(listDocumentTags(doc).map((tag) => tag.id));
      doc.transact(() => {
        const missingTags = tags.filter((tag) => !existingTagIds.has(tag.id));
        if (missingTags.length) seedTags(doc, missingTags);
        for (const page of pages) {
          if (!existing.has(page.id)) seedPage(doc, page);
        }
      });
    },

    /** Captures the converged document before its durable store is moved. */
    encodeState() {
      return encodeDocState(doc);
    },

    sendPresence(state) {
      client.sendAwareness(state);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      doc.off("update", notify);
      client.disconnect();
      this.setHandlers();
    },
  };
}
