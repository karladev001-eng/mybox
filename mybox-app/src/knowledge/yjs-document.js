import * as Y from "yjs";
import { BLOCK_TYPES } from "./domain.js";
import { splitPastedBlock } from "./editor-behavior.js";

/**
 * The shared representation of one Project. A shared Page lives here instead of
 * in the JSON state, so concurrent edits merge rather than raise the revision
 * conflict the local model reports ([ADR 0023]).
 *
 * Reads project this back into the Page and Block shape the rest of the App
 * already speaks, so Operations, events, and the editor stay unchanged.
 *
 *   pages: Y.Map<pageId, Y.Map>
 *     title      string
 *     state      "active" | "trash"
 *     tagIds     Y.Array<string>
 *     blocks     Y.Array<Y.Map>
 *       id       string
 *       type     string
 *       text     Y.Text          <- merged per character
 *       checked  boolean
 *       links    Y.Array<{ targetPageId, token }>
 *   tags: Y.Map<tagId, { label, normalizedLabel }>
 *   memberProfiles: Y.Map<profileId, { displayName, avatarUrl }>
 */
export function createProjectDoc() {
  return new Y.Doc();
}

const pagesOf = (doc) => doc.getMap("pages");
const tagsOf = (doc) => doc.getMap("tags");
const memberColorsOf = (doc) => doc.getMap("memberColors");
const memberProfilesOf = (doc) => doc.getMap("memberProfiles");

function isHighSurrogate(code) {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Smallest single-range edit turning `previous` into `next`.
 *
 * Replacing the whole Y.Text on every keystroke would discard a collaborator's
 * concurrent edit, because the delete covers characters they just typed. A
 * common-prefix/suffix range keeps the untouched characters untouched, which is
 * what lets two people type in one paragraph at once.
 *
 * Boundaries never split a surrogate pair, so an emoji is inserted or removed
 * whole rather than corrupted.
 */
export function textDelta(previous, next) {
  if (previous === next) return null;

  const shorter = Math.min(previous.length, next.length);
  let start = 0;
  while (start < shorter && previous[start] === next[start]) start += 1;
  if (start > 0 && isHighSurrogate(previous.charCodeAt(start - 1))) start -= 1;

  let end = 0;
  const maxEnd = shorter - start;
  while (end < maxEnd && previous[previous.length - 1 - end] === next[next.length - 1 - end]) end += 1;
  if (end > 0 && isHighSurrogate(next.charCodeAt(next.length - end))) end -= 1;

  return {
    index: start,
    remove: previous.length - start - end,
    insert: next.slice(start, next.length - end),
  };
}

function applyText(yText, nextText) {
  const delta = textDelta(yText.toString(), nextText);
  if (!delta) return;
  if (delta.remove > 0) yText.delete(delta.index, delta.remove);
  if (delta.insert) yText.insert(delta.index, delta.insert);
}

function newBlock(block = {}) {
  const map = new Y.Map();
  map.set("id", block.id);
  for (const key of ["message", "call", "turn", "revision"]) if (block[key] !== undefined) map.set(key, structuredClone(block[key]));
  map.set("type", BLOCK_TYPES.includes(block.type) ? block.type : "paragraph");
  map.set("checked", block.checked === true);
  if (block.updatedBy) map.set("updatedBy", block.updatedBy);
  const text = new Y.Text();
  if (block.text) text.insert(0, block.text);
  map.set("text", text);
  const links = new Y.Array();
  if (block.links?.length) links.push(block.links.map((link) => ({ ...link })));
  map.set("links", links);
  return map;
}

function newBlockId() {
  return `block-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function blockIndex(blocks, blockId) {
  for (let i = 0; i < blocks.length; i += 1) {
    if (blocks.get(i).get("id") === blockId) return i;
  }
  return -1;
}

/** Copies a Page from the local JSON state into the shared document. */
export function seedPage(doc, page) {
  doc.transact(() => {
    const map = new Y.Map();
    for (const key of ["folderId", "file", "kind", "recordVersion", "context", "provenance", "legacyContextUnavailable", "sessionMetadata", "createdAt", "updatedAt"]) if (page[key] !== undefined) map.set(key, structuredClone(page[key]));
    map.set("title", page.title);
    map.set("state", page.state ?? "active");
    if (page.createdBy) map.set("createdBy", page.createdBy);
    if (page.updatedBy) map.set("updatedBy", page.updatedBy);
    const tagIds = new Y.Array();
    if (page.tagIds?.length) tagIds.push([...page.tagIds]);
    map.set("tagIds", tagIds);
    const blocks = new Y.Array();
    map.set("blocks", blocks);
    blocks.push((page.blocks ?? []).map(newBlock));
    pagesOf(doc).set(page.id, map);
  });
}

export function seedTags(doc, tags) {
  doc.transact(() => {
    for (const tag of tags) tagsOf(doc).set(tag.id, { label: tag.label, normalizedLabel: tag.normalizedLabel });
  });
}

/** Projects shared Tag definitions without Page-specific counts. */
export function listTags(doc) {
  return [...tagsOf(doc).entries()].map(([id, tag]) => ({ id, ...tag }));
}

export function listPageIds(doc) {
  return [...pagesOf(doc).keys()];
}

export function listMemberColors(doc) {
  return [...memberColorsOf(doc).entries()].map(([profileId, color]) => ({ profileId, color }));
}

export function setMemberColor(doc, profileId, color) {
  doc.transact(() => memberColorsOf(doc).set(profileId, color));
}

/** Non-secret account presentation persists so an offline author's name remains readable. */
export function listMemberProfiles(doc) {
  return [...memberProfilesOf(doc).entries()].flatMap(([profileId, value]) => (
    value && typeof value.displayName === "string" && value.displayName.trim()
      ? [{ profileId, displayName: value.displayName, avatarUrl: value.avatarUrl ?? null }]
      : []
  ));
}

export function setMemberProfile(doc, profile) {
  const profileId = typeof profile?.profileId === "string" ? profile.profileId.trim() : "";
  const displayName = typeof profile?.displayName === "string" ? profile.displayName.trim() : "";
  const avatarUrl = typeof profile?.avatarUrl === "string" && /^https:\/\//.test(profile.avatarUrl) && profile.avatarUrl.length <= 2048
    ? profile.avatarUrl
    : null;
  if (!profileId || !displayName || displayName.length > 120) throw new Error("INVALID_MEMBER_PROFILE");
  const value = { displayName, avatarUrl };
  doc.transact(() => memberProfilesOf(doc).set(profileId, value));
  return { profileId, ...value };
}

/** Projects a shared Page back into the shape the editor and Operations use. */
export function readPage(doc, pageId) {
  const page = pagesOf(doc).get(pageId);
  if (!page) return null;
  return {
    id: pageId,
    ...Object.fromEntries(["folderId", "file", "kind", "recordVersion", "context", "provenance", "legacyContextUnavailable", "sessionMetadata", "createdAt", "updatedAt"].filter((key) => page.has(key)).map((key) => [key, structuredClone(page.get(key))])),
    title: page.get("title"),
    state: page.get("state"),
    ...(page.get("createdBy") ? { createdBy: page.get("createdBy") } : {}),
    ...(page.get("updatedBy") ? { updatedBy: page.get("updatedBy") } : {}),
    tagIds: page.get("tagIds").toArray(),
    blocks: page.get("blocks").map((block) => ({
      id: block.get("id"),
      ...Object.fromEntries(["message", "call", "turn", "revision"].filter((key) => block.has(key)).map((key) => [key, structuredClone(block.get(key))])),
      type: block.get("type"),
      text: block.get("text").toString(),
      checked: block.get("checked") === true,
      ...(block.get("updatedBy") ? { updatedBy: block.get("updatedBy") } : {}),
      links: block.get("links").toArray().map((link) => ({ ...link })),
    })),
  };
}

/**
 * Applies one Page mutation, using the same mutation vocabulary as the local
 * model so a caller does not branch on whether a Project is shared.
 *
 * There is no expected revision: a CRDT converges instead of rejecting, which
 * is the whole reason a shared Project uses this path.
 */
export function applyPageMutation(doc, pageId, mutation, { actorId } = {}) {
  const page = pagesOf(doc).get(pageId);
  if (!page) throw new Error(`PAGE_NOT_FOUND: ${pageId}`);
  if (page.get("kind") && page.get("kind") !== "note" && !["rename", "page-state"].includes(mutation.type)) throw new Error("IMMUTABLE_RECORD");
  const blocks = page.get("blocks");

  doc.transact(() => {
    switch (mutation.type) {
      case "rename":
        page.set("title", mutation.title);
        break;

      case "page-state":
        page.set("state", mutation.state);
        break;

      case "tags-set": {
        const tagIds = page.get("tagIds");
        tagIds.delete(0, tagIds.length);
        if (mutation.tagIds?.length) tagIds.push([...mutation.tagIds]);
        break;
      }

      case "block-update": {
        const index = blockIndex(blocks, mutation.blockId);
        if (index < 0) throw new Error(`BLOCK_NOT_FOUND: ${mutation.blockId}`);
        const block = blocks.get(index);
        if (mutation.blockType !== undefined) block.set("type", mutation.blockType);
        if (mutation.checked !== undefined) block.set("checked", mutation.checked === true);
        if (mutation.text !== undefined) applyText(block.get("text"), mutation.text);
        if (actorId) block.set("updatedBy", actorId);
        break;
      }

      case "block-add": {
        const after = mutation.afterBlockId ? blockIndex(blocks, mutation.afterBlockId) : blocks.length - 1;
        blocks.insert(after < 0 ? blocks.length : after + 1, [newBlock(mutation.block ?? { id: mutation.blockId })]);
        if (actorId) blocks.get(after < 0 ? blocks.length - 1 : after + 1)?.set("updatedBy", actorId);
        break;
      }

      case "block-paste": {
        const index = blockIndex(blocks, mutation.blockId);
        if (index < 0) throw new Error(`BLOCK_NOT_FOUND: ${mutation.blockId}`);
        const current = blocks.get(index);
        const sourceText = mutation.sourceText === undefined ? current.get("text").toString() : mutation.sourceText;
        const split = splitPastedBlock({
          id: current.get("id"),
          type: current.get("type"),
          text: sourceText,
          checked: current.get("checked") === true,
          links: current.get("links").toArray(),
        }, mutation.text, mutation.selectionStart, mutation.selectionEnd);
        if (!split) throw new Error("INVALID_PAGE_MUTATION: Pasted text produced no Blocks");

        const [first, ...rest] = split.blocks;
        current.set("type", BLOCK_TYPES.includes(first.type) ? first.type : "paragraph");
        current.set("checked", first.checked === true);
        applyText(current.get("text"), first.text);
        const links = current.get("links");
        links.delete(0, links.length);
        if (first.links.length) links.push(first.links.map((link) => ({ ...link })));
        if (actorId) current.set("updatedBy", actorId);
        if (rest.length) {
          blocks.insert(index + 1, rest.map((block) => newBlock({ ...block, id: newBlockId(), updatedBy: actorId })));
        }
        break;
      }

      case "block-remove": {
        const index = blockIndex(blocks, mutation.blockId);
        if (index >= 0) blocks.delete(index, 1);
        break;
      }

      case "blocks-remove": {
        const blockIds = [...new Set(Array.isArray(mutation.blockIds) ? mutation.blockIds : [])];
        if (!blockIds.length) throw new Error("INVALID_PAGE_MUTATION: At least one Block is required");
        const indices = blockIds.map((blockId) => {
          const index = blockIndex(blocks, blockId);
          if (index < 0) throw new Error(`BLOCK_NOT_FOUND: ${blockId}`);
          return index;
        });
        if (new Set(indices).size === blocks.length) {
          const placeholder = blocks.get(0);
          placeholder.set("type", "paragraph");
          placeholder.set("checked", false);
          applyText(placeholder.get("text"), "");
          placeholder.get("links").delete(0, placeholder.get("links").length);
          if (actorId) placeholder.set("updatedBy", actorId);
          indices.filter((index) => index !== 0).sort((left, right) => right - left).forEach((index) => blocks.delete(index, 1));
        } else {
          indices.sort((left, right) => right - left).forEach((index) => blocks.delete(index, 1));
        }
        break;
      }

      case "blocks-restore": {
        const entries = Array.isArray(mutation.blocks) ? mutation.blocks : [];
        if (!entries.length) throw new Error("INVALID_PAGE_MUTATION: Blocks to restore are required");
        for (const entry of entries) {
          const restored = entry?.block;
          if (!restored || typeof restored.id !== "string" || !BLOCK_TYPES.includes(restored.type) || typeof restored.text !== "string") {
            throw new Error("INVALID_PAGE_MUTATION: A restored Block is invalid");
          }
          const snapshot = { ...restored, updatedBy: actorId ?? restored.updatedBy, links: restored.links ?? [] };
          const existingIndex = blockIndex(blocks, restored.id);
          if (existingIndex >= 0) {
            blocks.delete(existingIndex, 1);
            blocks.insert(existingIndex, [newBlock(snapshot)]);
            continue;
          }
          const targetIndex = entry.beforeBlockId === null || entry.beforeBlockId === undefined
            ? blocks.length
            : blockIndex(blocks, entry.beforeBlockId);
          blocks.insert(targetIndex < 0 ? blocks.length : targetIndex, [newBlock(snapshot)]);
        }
        break;
      }

      case "block-move": {
        const index = blockIndex(blocks, mutation.blockId);
        if (index < 0) throw new Error(`BLOCK_NOT_FOUND: ${mutation.blockId}`);
        // Y.Array has no move, so the block is re-created at the destination.
        // Its text stops being collaborative for that edit, which is why moving
        // is a deliberate structural action rather than part of typing.
        const snapshot = readPage(doc, pageId).blocks[index];
        blocks.delete(index, 1);
        const target = mutation.beforeBlockId === null || mutation.beforeBlockId === undefined
          ? blocks.length
          : Math.max(0, blockIndex(blocks, mutation.beforeBlockId));
        blocks.insert(target, [newBlock(snapshot)]);
        break;
      }

      case "link-add": {
        const index = blockIndex(blocks, mutation.blockId);
        if (index < 0) throw new Error(`BLOCK_NOT_FOUND: ${mutation.blockId}`);
        const block = blocks.get(index);
        applyText(block.get("text"), mutation.text);
        block.get("links").push([{ targetPageId: mutation.targetPageId, token: mutation.token }]);
        break;
      }

      default:
        throw new Error(`INVALID_PAGE_MUTATION: ${mutation.type}`);
    }
    if (actorId) page.set("updatedBy", actorId);
  });

  return readPage(doc, pageId);
}

export function createPage(doc, page) {
  seedPage(doc, page);
  return readPage(doc, page.id);
}

/** Removes a Page from the shared document for an explicit owner purge. */
export function deletePage(doc, pageId) {
  const page = readPage(doc, pageId);
  if (!page) throw new Error(`PAGE_NOT_FOUND: ${pageId}`);
  doc.transact(() => pagesOf(doc).delete(pageId));
  return page;
}

/** The bytes a peer needs to reach this document's current state. */
export function encodeState(doc) {
  return Y.encodeStateAsUpdate(doc);
}

/**
 * `origin` lets a caller mark where an update came from. A sync client tags
 * relayed updates so it can tell them apart from local edits and avoid echoing
 * them back to the room.
 */
export function applyUpdate(doc, update, origin) {
  Y.applyUpdate(doc, update, origin);
}

/** Append immutable record Blocks without replacing concurrent messages. */
export function commitRecordPage(doc, value) {
  const existing = pagesOf(doc).get(value.id);
  if (!existing) { seedPage(doc, value); return; }
  doc.transact(() => {
    for (const key of ["folderId", "file", "title", "kind", "recordVersion", "context", "provenance", "legacyContextUnavailable", "sessionMetadata", "createdAt", "updatedAt"]) if (value[key] !== undefined) existing.set(key, structuredClone(value[key]));
    const blocks = existing.get("blocks");
    for (const incoming of value.blocks.filter((b) => b.turn)) {
      const current = blocks.toArray().find((b) => b.get("id") === incoming.id);
      if (current) current.set("turn", structuredClone(incoming.turn));
    }
    const ids = new Set(blocks.map((b) => b.get("id")));
    const additions = value.blocks.filter((b) => !ids.has(b.id));
    if (additions.length) blocks.push(additions.map(newBlock));
  });
}
